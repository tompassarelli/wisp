// Switching an offline Warcraft III 3.0 client's network provider to LAN
// (wisp:docs/lan.md). Patch 3.0.0 removed LAN: the menus' handler for
// InitializeLocalNetProvider selects the loopback provider `LOOP` with one
// `mov ecx,'LOOP'`. W3Champions' launcher and wc3-slop-lan's activator write
// `TCPN` over that operand, have the game rebuild its provider, and write
// `LOOP` back at once; Wisp does the same through /proc/PID/mem. The patch must
// not stay: left in place, war3_loader.dll closes the game within a minute.
//
// Only an offline client may be switched: offline.ts proves the process has
// no network but loopback before anything is written.
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync, writeSync } from "node:fs";

/** A byte pattern: a number is a byte, undefined matches anything. */
export type Pattern = readonly (number | undefined)[];

/** Hex bytes with `??` wildcards, such as "48 83 EC 58 E8 ?? ?? ?? ??". */
export function pattern(text: string): Pattern {
  return text.split(/\s+/).filter((token) => token !== "").map((token) => {
    if (token === "??") return undefined;
    const value = Number.parseInt(token, 16);
    if (!/^[0-9a-fA-F]{2}$/.test(token)) throw new Error(`pattern byte ${token} isn't two hex digits`);
    return value;
  });
}

/** Offsets in `bytes` where `wanted` matches. */
export function findAll(bytes: Uint8Array, wanted: Pattern): number[] {
  const found: number[] = [];
  const first = wanted[0];
  outer: for (let at = 0; at + wanted.length <= bytes.length; at++) {
    if (first !== undefined && bytes[at] !== first) continue;
    for (let index = 1; index < wanted.length; index++) {
      const byte = wanted[index];
      if (byte !== undefined && bytes[at + index] !== byte) continue outer;
    }
    found.push(at);
  }
  return found;
}

/** Provider ids as the operand's little-endian bytes: 'LOOP' is 50 4F 4F 4C. */
export const LOOP = Buffer.from("POOL", "latin1");
export const TCPN = Buffer.from("NPCT", "latin1");

/** The provider an operand selects, spelled as the game spells it. */
export const providerName = (operand: Uint8Array) => Buffer.from(operand).toString("latin1").split("").reverse().join("");

/**
 * The selector in InitializeLocalNetProvider's handler on 3.0.0.24268:
 * `sub rsp,0x58; call ..; mov ecx,'LOOP'; call ..; call ..; lea rcx,..; mov qword [rsp+0x28],4`.
 * The operand is 10 bytes in. (Pattern from wc3-slop-lan's docs/porting.md §2.1.)
 */
export const SELECTOR = pattern("48 83 EC 58 E8 ?? ?? ?? ?? B9 ?? ?? ?? ?? E8 ?? ?? ?? ?? E8 ?? ?? ?? ?? 48 8D 0D ?? ?? ?? ?? 48 C7 44 24 28 04 00 00 00");
export const SELECTOR_OPERAND = 10;

/** The provider factory, `cmp ebx,'BNET'; je; cmp ebx,'LOOP'; je; cmp ebx,'TCPN'; jne`: the build still makes a TCPN provider. */
export const FACTORY = pattern("81 FB 54 45 4E 42 74 ?? 81 FB 50 4F 4F 4C 74 ?? 81 FB 4E 50 43 54 0F 85");

/** Builds whose code these patterns were checked against. */
export const KNOWN_BUILDS: readonly string[] = ["3.0.0.24268"];

/** Selector operands in `bytes` that select LOOP or TCPN: offset of the operand and its bytes. */
export function selectorOperands(bytes: Uint8Array): { readonly at: number; readonly operand: Buffer }[] {
  return findAll(bytes, SELECTOR).flatMap((start) => {
    const at = start + SELECTOR_OPERAND;
    const operand = Buffer.from(bytes.subarray(at, at + 4));
    return operand.equals(LOOP) || operand.equals(TCPN) ? [{ at, operand }] : [];
  });
}

/** A process's memory for reading and writing, through /proc/PID/mem. */
export interface ProcessMemory {
  readonly read: (address: number, length: number) => Buffer;
  readonly write: (address: number, bytes: Uint8Array) => void;
  readonly close: () => void;
}

/** A /proc/PID/maps line with the inode, which says which file a shared mapping shows. */
export interface FileMapping {
  readonly start: number;
  readonly end: number;
  readonly permissions: string;
  readonly offset: number;
  readonly inode: number;
  readonly path: string;
}

export function fileMappings(text: string): FileMapping[] {
  return text.split("\n").flatMap((line) => {
    const match = /^([0-9a-f]+)-([0-9a-f]+) (\S{4}) ([0-9a-f]+) \S+ (\d+)\s*(.*)$/.exec(line);
    if (match === null) return [];
    return [{ start: Number.parseInt(match[1] ?? "", 16), end: Number.parseInt(match[2] ?? "", 16), permissions: match[3] ?? "", offset: Number.parseInt(match[4] ?? "", 16), inode: Number(match[5]), path: match[6] ?? "" }];
  });
}

/**
 * Where a write to `address` must go. Wine maps the game image from a
 * shared memfd ("/memfd:wine-mapping"), and the kernel refuses a forced
 * /proc/PID/mem write to a shared mapping it can't copy on write. The game
 * holds that memfd open, so the write goes to the memfd itself, through the
 * game's own descriptor, at the mapping's file offset.
 */
export function writeTarget(pid: number, mappings: readonly FileMapping[], address: number): { readonly file: string; readonly position: number } {
  const mapping = mappings.find(({ start, end }) => address >= start && address < end);
  if (mapping === undefined) throw new Error(`0x${address.toString(16)} isn't mapped in pid ${pid}`);
  if (!mapping.permissions.endsWith("s")) return { file: `/proc/${pid}/mem`, position: address };
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    try {
      if (statSync(`/proc/${pid}/fd/${fd}`).ino === mapping.inode) return { file: `/proc/${pid}/fd/${fd}`, position: mapping.offset + address - mapping.start };
    } catch {
      // Descriptors close while they are listed.
    }
  }
  throw new Error(`pid ${pid} maps 0x${address.toString(16)} shared from ${mapping.path} (inode ${mapping.inode}) but holds no descriptor for it`);
}

/** Writes `bytes` at `address` in pid, through writeTarget. */
export function writeProcess(pid: number, address: number, bytes: Uint8Array): void {
  const target = writeTarget(pid, fileMappings(readFileSync(`/proc/${pid}/maps`, "latin1")), address);
  const fd = openSync(target.file, "r+");
  try {
    const wrote = writeSync(fd, bytes, 0, bytes.length, target.position);
    if (wrote !== bytes.length) throw new Error(`wrote ${wrote} of ${bytes.length} bytes at 0x${address.toString(16)}`);
  } finally {
    closeSync(fd);
  }
}

export function processMemory(pid: number): ProcessMemory {
  const fd = openSync(`/proc/${pid}/mem`, "r");
  return {
    read: (address, length) => {
      const buffer = Buffer.alloc(length);
      const got = readSync(fd, buffer, 0, length, address);
      if (got !== length) throw new Error(`read ${got} of ${length} bytes at 0x${address.toString(16)}`);
      return buffer;
    },
    write: (address, bytes) => writeProcess(pid, address, bytes),
    close: () => closeSync(fd),
  };
}

/** A readable span of the image's code: where it is and its bytes. */
export interface CodeSpan {
  readonly start: number;
  readonly bytes: Buffer;
}

/** Selector and factory sites in the decrypted spans; addresses are absolute. */
export function scanCode(spans: readonly CodeSpan[]) {
  const selectors = spans.flatMap(({ start, bytes }) => selectorOperands(bytes).map(({ at, operand }) => ({ address: start + at, operand })));
  const factories = spans.flatMap(({ start, bytes }) => findAll(bytes, FACTORY).map((at) => start + at));
  return { selectors, factories };
}

/** Thread ids of `pid` and each one's state letter (T = stopped). */
export function threadStates(pid: number): Map<number, string> {
  const states = new Map<number, string>();
  for (const entry of readdirSync(`/proc/${pid}/task`)) {
    try {
      const stat = readFileSync(`/proc/${pid}/task/${entry}/stat`, "latin1");
      states.set(Number(entry), stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3));
    } catch {
      // The thread ended while the list was read.
    }
  }
  return states;
}

/** The instruction pointer of a stopped thread, from /proc/PID/task/TID/syscall ("-1 SP PC" or "NR ARGS... SP PC"). */
export function stoppedPc(syscallText: string): number | undefined {
  const fields = syscallText.trim().split(/\s+/);
  if (fields[0] === "running" || fields.length < 3) return undefined;
  const pc = fields.at(-1) ?? "";
  return /^0x[0-9a-f]+$/i.test(pc) ? Number.parseInt(pc, 16) : undefined;
}
