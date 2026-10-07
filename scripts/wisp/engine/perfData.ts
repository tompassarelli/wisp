// Samples from a perf.data file that `perf record --call-graph dwarf` wrote,
// and the game frames in each sample's user stack. `wisp engine watch` sets a
// hardware write breakpoint with perf (no ptrace: a debugger attach makes a
// signed-in client exit), so every sample is one write to the watched address.
// Warcraft III's code has no frame pointers or symbols, so the frames are the
// qwords on the copied stack that are return addresses into the image: they
// follow a call instruction in the client's decrypted code (wisp:docs/engine.md).
import type { EngineOffsets } from "./offsets";
import { type FunctionTable, type Memory, functionAt } from "./memory";

export interface PerfSample {
  /** perf's clock, nanoseconds. */
  readonly time: bigint;
  readonly pid: number;
  readonly tid: number;
  readonly ip: number;
  /** User stack bytes copied from the stack pointer up. */
  readonly stack: Buffer;
}

export interface PerfData {
  readonly samples: readonly PerfSample[];
  /** Samples the kernel dropped (PERF_RECORD_LOST). */
  readonly lost: number;
}

const SAMPLE = {
  IP: 1 << 0, TID: 1 << 1, TIME: 1 << 2, ADDR: 1 << 3, READ: 1 << 4, CALLCHAIN: 1 << 5, ID: 1 << 6, CPU: 1 << 7,
  PERIOD: 1 << 8, STREAM_ID: 1 << 9, RAW: 1 << 10, BRANCH_STACK: 1 << 11, REGS_USER: 1 << 12, STACK_USER: 1 << 13, IDENTIFIER: 1 << 16,
};
const RECORD_LOST = 2;
const RECORD_SAMPLE = 9;

/** Parses a perf.data (version 2) file's samples. */
export function parsePerfData(file: Buffer): PerfData {
  if (file.toString("latin1", 0, 8) !== "PERFILE2") throw new Error("not a perf.data file (PERFILE2)");
  const attrsOffset = Number(file.readBigUInt64LE(24));
  const dataOffset = Number(file.readBigUInt64LE(40));
  const dataSize = Number(file.readBigUInt64LE(48));
  // perf_event_attr: sample_type at 24, sample_regs_user at 80.
  const sampleType = Number(file.readBigUInt64LE(attrsOffset + 24));
  const regsMask = file.readBigUInt64LE(attrsOffset + 80);
  const has = (bit: number) => (sampleType & bit) !== 0;
  if (has(SAMPLE.READ) || has(SAMPLE.BRANCH_STACK)) throw new Error("perf.data samples carry read or branch data; record with `-e mem:ADDR/4:w --call-graph dwarf` only");
  let registers = 0;
  for (let bit = 0n; bit < 64n; bit++) if ((regsMask >> bit) & 1n) registers++;
  const samples: PerfSample[] = [];
  let lost = 0;
  for (let at = dataOffset; at + 8 <= dataOffset + dataSize;) {
    const type = file.readUInt32LE(at);
    const size = file.readUInt16LE(at + 6);
    if (size === 0) break;
    if (type === RECORD_LOST) lost += Number(file.readBigUInt64LE(at + 16));
    if (type === RECORD_SAMPLE) {
      let p = at + 8;
      let ip = 0;
      let pid = 0;
      let tid = 0;
      let time = 0n;
      if (has(SAMPLE.IDENTIFIER)) p += 8;
      if (has(SAMPLE.IP)) { ip = Number(file.readBigUInt64LE(p)); p += 8; }
      if (has(SAMPLE.TID)) { pid = file.readUInt32LE(p); tid = file.readUInt32LE(p + 4); p += 8; }
      if (has(SAMPLE.TIME)) { time = file.readBigUInt64LE(p); p += 8; }
      for (const field of [SAMPLE.ADDR, SAMPLE.ID, SAMPLE.STREAM_ID, SAMPLE.CPU, SAMPLE.PERIOD]) if (has(field)) p += 8;
      if (has(SAMPLE.CALLCHAIN)) p += 8 + Number(file.readBigUInt64LE(p)) * 8;
      if (has(SAMPLE.RAW)) p += 4 + file.readUInt32LE(p);
      if (has(SAMPLE.REGS_USER)) {
        const abi = file.readBigUInt64LE(p);
        p += 8 + (abi === 0n ? 0 : registers * 8);
      }
      let stack = Buffer.alloc(0);
      if (has(SAMPLE.STACK_USER)) {
        const copied = Number(file.readBigUInt64LE(p));
        p += 8;
        const bytes = file.subarray(p, p + copied);
        const used = copied === 0 ? 0 : Number(file.readBigUInt64LE(p + copied));
        stack = Buffer.from(bytes.subarray(0, used === 0 ? copied : Math.min(used, copied)));
      }
      samples.push({ time, pid, tid, ip, stack });
    }
    at += size;
  }
  return { samples, lost };
}

/** Whether the bytes just before `returnAddress` (the 7 bytes `before`) end in a call instruction. */
export function followsCall(before: Buffer): boolean {
  const back = (distance: number) => before[before.length - distance] ?? -1;
  if (back(5) === 0xe8) return true;
  // FF /2: call through a register or memory operand, 2 to 7 bytes after any prefix.
  for (let length = 2; length <= 7; length++) {
    if (back(length) !== 0xff) continue;
    const modrm = back(length - 1);
    if (((modrm >> 3) & 7) !== 2) continue;
    const mod = modrm >> 6;
    const rm = modrm & 7;
    let size = 2;
    if (mod !== 3 && rm === 4) {
      size += 1;
      if (mod === 0 && (back(length - 2) & 7) === 5) size += 4;
    }
    if (mod === 0 && rm === 5) size += 4;
    if (mod === 1) size += 1;
    if (mod === 2) size += 4;
    if (size === length) return true;
  }
  return false;
}

export interface Frame {
  readonly rva: number;
  /** `tag allocator+0xe7`, `fn 0x19b550+0x1f5`, or the RVA alone outside every function. */
  readonly label: string;
}

export function frameLabel(rva: number, functions: FunctionTable, roles: ReadonlyMap<number, string>): string {
  const start = functionAt(functions, rva);
  if (start === undefined) return `0x${rva.toString(16)}`;
  const role = roles.get(start);
  return `${role ?? `fn 0x${start.toString(16)}`}+0x${(rva - start).toString(16)}`;
}

export interface Symbolizer {
  readonly base: number;
  /** End of the image's code, as an RVA. */
  readonly codeEnd: number;
  readonly functions: FunctionTable;
  readonly offsets: EngineOffsets;
  /** The client's memory, to check return addresses against its decrypted code; without it every image address on the stack counts. */
  readonly memory: Memory | undefined;
}

/** The sample's instruction and the return addresses into the game's code on its stack, innermost first. */
export function sampleFrames(sample: PerfSample, symbolizer: Symbolizer, limit = 24): Frame[] {
  const { base, codeEnd, functions, offsets, memory } = symbolizer;
  const inCode = (address: number) => address >= base + 0x1000 && address < base + codeEnd;
  const frame = (address: number): Frame => ({ rva: address - base, label: frameLabel(address - base, functions, offsets.roles) });
  const frames: Frame[] = inCode(sample.ip) ? [frame(sample.ip)] : [];
  const checked = new Map<number, boolean>();
  for (let at = 0; at + 8 <= sample.stack.length && frames.length < limit; at += 8) {
    const address = Number(sample.stack.readBigUInt64LE(at));
    if (!inCode(address)) continue;
    let call = checked.get(address);
    if (call === undefined) {
      try {
        call = memory === undefined || followsCall(memory.read(address - 7, 7));
      } catch {
        call = true;
      }
      checked.set(address, call);
    }
    if (call) frames.push(frame(address));
  }
  return frames;
}
