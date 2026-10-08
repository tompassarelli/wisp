// Read-only access to a running Warcraft III client: its process, its
// mappings, its image base and its memory through /proc/PID/mem, plus the
// game executable's headers, function table (.pdata) and file version read
// from disk. Nothing here writes to the process or attaches a debugger: a gdb
// attach makes a signed-in client exit.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

/** A process's memory, read-only. `read` throws when the range isn't readable. */
export interface Memory {
  readonly read: (address: number, length: number) => Buffer;
}

export const u64 = (memory: Memory, address: number) => Number(memory.read(address, 8).readBigUInt64LE(0));
export const u32 = (memory: Memory, address: number) => memory.read(address, 4).readUInt32LE(0);
export const i32 = (memory: Memory, address: number) => memory.read(address, 4).readInt32LE(0);

/** /proc/PID/mem opened read-only. */
export function procMemory(pid: number): Memory & { readonly close: () => void } {
  const fd = openSync(`/proc/${pid}/mem`, "r");
  return {
    read: (address, length) => {
      const buffer = Buffer.alloc(length);
      const got = readSync(fd, buffer, 0, length, address);
      if (got !== length) throw new Error(`read ${got} of ${length} bytes at 0x${address.toString(16)}`);
      return buffer;
    },
    close: () => closeSync(fd),
  };
}

export interface Mapping {
  readonly start: number;
  readonly end: number;
  readonly permissions: string;
  readonly offset: number;
  readonly path: string;
}

/** /proc/PID/maps lines. */
export function parseMaps(text: string): Mapping[] {
  return text.split("\n").flatMap((line) => {
    const match = /^([0-9a-f]+)-([0-9a-f]+) (\S{4}) ([0-9a-f]+) \S+ \d+\s*(.*)$/.exec(line);
    if (match === null) return [];
    return [{ start: Number.parseInt(match[1] ?? "", 16), end: Number.parseInt(match[2] ?? "", 16), permissions: match[3] ?? "", offset: Number.parseInt(match[4] ?? "", 16), path: match[5] ?? "" }];
  });
}

/** Whether `address` lies in a readable mapping; `maps` sorted by start. */
export function readableAt(maps: readonly Mapping[], address: number): boolean {
  let low = 0;
  let high = maps.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const mapping = maps[middle];
    if (mapping === undefined) return false;
    if (address < mapping.start) high = middle - 1;
    else if (address >= mapping.end) low = middle + 1;
    else return mapping.permissions.startsWith("r");
  }
  return false;
}

export interface PeHeader {
  readonly sizeOfImage: number;
  readonly timeDateStamp: number;
  readonly sections: readonly { readonly name: string; readonly rva: number; readonly virtualSize: number; readonly rawOffset: number; readonly rawSize: number }[];
}

/** A PE's COFF and section headers from its first bytes (0x1000 is enough). */
export function peHeader(bytes: Buffer): PeHeader | undefined {
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d) return undefined;
  const pe = bytes.readUInt32LE(0x3c);
  if (pe + 24 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550) return undefined;
  const count = bytes.readUInt16LE(pe + 6);
  const optional = bytes.readUInt16LE(pe + 20);
  const sections = [];
  for (let index = 0, at = pe + 24 + optional; index < count && at + 40 <= bytes.length; index++, at += 40) {
    sections.push({
      name: bytes.toString("latin1", at, at + 8).replace(/\0+$/, ""),
      virtualSize: bytes.readUInt32LE(at + 8),
      rva: bytes.readUInt32LE(at + 12),
      rawSize: bytes.readUInt32LE(at + 16),
      rawOffset: bytes.readUInt32LE(at + 20),
    });
  }
  return { sizeOfImage: bytes.readUInt32LE(pe + 24 + 56), timeDateStamp: bytes.readUInt32LE(pe + 8), sections };
}

/**
 * The image base of the executable whose header is `exe`: the readable
 * mapping at file offset 0 whose first page carries the same PE header.
 * Wine maps the image twice; the whole-image alias (one mapping of
 * SizeOfImage bytes) is not where the code runs.
 */
export function findImageBase(maps: readonly Mapping[], memory: Memory, exe: PeHeader): number | undefined {
  for (const mapping of maps) {
    if (mapping.offset !== 0 || !mapping.permissions.startsWith("r") || mapping.end - mapping.start >= exe.sizeOfImage) continue;
    let page: Buffer;
    try {
      page = memory.read(mapping.start, 0x1000);
    } catch {
      continue;
    }
    const header = peHeader(page);
    if (header !== undefined && header.sizeOfImage === exe.sizeOfImage && header.timeDateStamp === exe.timeDateStamp) return mapping.start;
  }
  return undefined;
}

function readRange(path: string, offset: number, length: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, offset);
    return buffer;
  } finally {
    closeSync(fd);
  }
}

/** The executable's VS_FIXEDFILEINFO file version, such as `3.0.0.24268`, from bytes of its .rsrc. */
export function fileVersion(resources: Buffer): string | undefined {
  const at = resources.indexOf(Buffer.from([0xbd, 0x04, 0xef, 0xfe]));
  if (at < 0 || at + 16 > resources.length) return undefined;
  const high = resources.readUInt32LE(at + 8);
  const low = resources.readUInt32LE(at + 12);
  return `${high >>> 16}.${high & 0xffff}.${low >>> 16}.${low & 0xffff}`;
}

/** Function start and end RVAs from .pdata (RUNTIME_FUNCTION: begin, end, unwind), sorted by begin. */
export type FunctionTable = Uint32Array;

/** The function containing `rva`: its start, or undefined outside every function. */
export function functionAt(table: FunctionTable, rva: number): number | undefined {
  let low = 0;
  let high = table.length / 3 - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const begin = table[middle * 3] ?? 0;
    const end = table[middle * 3 + 1] ?? 0;
    if (rva < begin) high = middle - 1;
    else if (rva >= end) low = middle + 1;
    else return begin;
  }
  return undefined;
}

export interface GameExecutable {
  readonly path: string;
  readonly header: PeHeader;
  readonly version: string;
  readonly functions: FunctionTable;
}

/**
 * The executable's header, version and function table, read from disk. .text
 * is encrypted on disk and decrypted page by page in a running client; the
 * headers, .rsrc and .pdata are not.
 */
export function readExecutable(path: string): GameExecutable {
  const header = peHeader(readRange(path, 0, 0x1000));
  if (header === undefined) throw new Error(`${path} is not a PE executable`);
  const section = (name: string) => header.sections.find((candidate) => candidate.name === name);
  const resources = section(".rsrc");
  const version = resources === undefined ? undefined : fileVersion(readRange(path, resources.rawOffset, resources.rawSize));
  if (version === undefined) throw new Error(`${path} has no file version`);
  const pdata = section(".pdata");
  const raw = pdata === undefined ? Buffer.alloc(0) : readRange(path, pdata.rawOffset, Math.min(pdata.rawSize, pdata.virtualSize));
  const functions = new Uint32Array(Math.floor(raw.length / 12) * 3);
  for (let index = 0; index < functions.length; index++) functions[index] = raw.readUInt32LE(index * 4);
  return { path, header, version, functions };
}

/** The Windows path a Wine prefix maps it to: `C:\Program Files (x86)\…` → PREFIX/drive_c/Program Files (x86)/… */
export function prefixPath(prefix: string, windowsPath: string): string {
  const match = /^([A-Za-z]):\\(.*)$/.exec(windowsPath);
  if (match === null) return windowsPath;
  return join(prefix, `drive_${(match[1] ?? "c").toLowerCase()}`, ...(match[2] ?? "").split("\\"));
}

/** A client's Wine prefix from its Documents/Warcraft III folder, as the clients file records it. */
export function prefixOfDocuments(documents: string): string {
  const at = documents.indexOf("/drive_c/");
  return at < 0 ? documents : documents.slice(0, at);
}

export interface GameProcess {
  readonly pid: number;
  /** The game executable on disk. */
  readonly exe: string;
}

const GAME = /^([A-Za-z]:\\[^\0]*\\Warcraft III\.exe)\0/;

/** This user's running Warcraft III.exe processes whose WINEPREFIX is `prefix`. */
export function findGameProcesses(prefix: string): GameProcess[] {
  const wanted = prefix.replace(/\/+$/, "");
  const uid = process.getuid?.();
  const found: GameProcess[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (uid !== undefined && statSync(`/proc/${entry}`).uid !== uid) continue;
      const command = GAME.exec(readFileSync(`/proc/${entry}/cmdline`, "latin1"));
      if (command === null) continue;
      const environment = readFileSync(`/proc/${entry}/environ`, "latin1").split("\0");
      const winePrefix = environment.find((variable) => variable.startsWith("WINEPREFIX="))?.slice("WINEPREFIX=".length).replace(/\/+$/, "");
      if (winePrefix !== wanted) continue;
      found.push({ pid: Number(entry), exe: prefixPath(wanted, command[1] ?? "") });
    } catch {
      // Processes come and go while /proc is listed.
    }
  }
  return found;
}

/**
 * Why this machine can't read another process's memory, or undefined when it
 * can. Yama's ptrace_scope 1 limits /proc/PID/mem to a process's ancestors;
 * the owner sets 0 for the debugging session and restores the value after.
 * Wisp never changes it.
 */
export function memoryAccessProblem(scopeText: string | undefined): string | undefined {
  if (scopeText === undefined) return undefined;
  const scope = scopeText.trim();
  if (scope === "0") return undefined;
  return [
    `reading a client's memory needs kernel.yama.ptrace_scope=0; it is ${scope}. Wisp doesn't change it.`,
    "Set it for this debugging session only, with the owner's agreement:",
    "  sudo sysctl kernel.yama.ptrace_scope=0",
    "and restore it afterwards:",
    `  sudo sysctl kernel.yama.ptrace_scope=${scope}`,
  ].join("\n");
}

export const PTRACE_SCOPE = "/proc/sys/kernel/yama/ptrace_scope";

export function currentMemoryAccessProblem(): string | undefined {
  return memoryAccessProblem(existsSync(PTRACE_SCOPE) ? readFileSync(PTRACE_SCOPE, "utf8") : undefined);
}
