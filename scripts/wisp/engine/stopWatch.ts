// A hardware write watchpoint that stops the writing thread: ptrace seizes
// the game's main thread, loads debug registers DR0/DR7 with the watched
// address, and at each write the thread stops with SIGTRAP while `onHit`
// reads whatever it needs, such as the Lua VM's exact CallInfo chain, before
// the thread continues. Other signals pass straight through. This traps and
// stops the process, so it runs only on a verifiably offline client
// (wisp:scripts/wisp/engine/attach.ts, "trap"); a ptrace attach made a
// signed-in client exit (#158).
//
// Bun's FFI calls libc's ptrace and waitpid directly; perf can't stop a thread,
// and its samples arrive after the Lua VM has moved on.
import { dlopen, FFIType, ptr } from "bun:ffi";

const PTRACE_PEEKUSER = 3;
const PTRACE_POKEUSER = 6;
const PTRACE_CONT = 7;
const PTRACE_DETACH = 17;
const PTRACE_SEIZE = 0x4206;
const PTRACE_INTERRUPT = 0x4207;
const PTRACE_EVENT_STOP = 128;
const WALL = 0x40000000;
const WNOHANG = 1;
const SIGTRAP = 5;
/** offsetof(struct user, u_debugreg) on x86_64. */
const DEBUG_REGISTERS = 848;

/** DR7 for one 4-byte write watchpoint in DR0: local enable, RW0 = write, LEN0 = 4 bytes. */
export const DR7_WRITE_4 = 1 | (1 << 16) | (3 << 18);

let libc: ReturnType<typeof open> | undefined;
function open() {
  return dlopen("libc.so.6", {
    ptrace: { args: [FFIType.i64, FFIType.i32, FFIType.u64, FFIType.u64], returns: FFIType.i64 },
    waitpid: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    __errno_location: { args: [], returns: FFIType.ptr },
  });
}

export interface StopWatchOptions {
  /** The thread to watch; the game's main thread has the process's ID. */
  readonly tid: number;
  readonly address: number;
  readonly seconds: number;
  /** At most this many stops. */
  readonly limit: number;
  /** Runs while the thread is stopped right after a write. */
  readonly onHit: (hit: number) => void;
}

/** Watches writes to `address` by thread `tid`; returns how many stopped it. Detaches on every path. */
export function stopWatch({ tid, address, seconds, limit, onHit }: StopWatchOptions): number {
  libc ??= open();
  const { ptrace, waitpid } = libc.symbols;
  const status = new Int32Array(1);
  const call = (what: string, result: bigint | number) => {
    if (Number(result) === -1) throw new Error(`${what} failed for thread ${tid}`);
  };
  const wait = (flags: number) => waitpid(tid, ptr(status), WALL | flags);
  call("PTRACE_SEIZE", ptrace(PTRACE_SEIZE, tid, 0, 0));
  let hits = 0;
  let attached = true;
  const detach = () => {
    if (!attached) return;
    attached = false;
    // Stop the thread to clear its debug registers, then let it go.
    ptrace(PTRACE_INTERRUPT, tid, 0, 0);
    for (let tries = 0; tries < 1000; tries++) {
      if (wait(0) !== tid) break;
      const stopped = (status[0]! & 0xff) === 0x7f;
      const event = status[0]! >> 16;
      if (stopped && event === PTRACE_EVENT_STOP) break;
      // A signal stop that came first: deliver it and wait for the interrupt.
      ptrace(PTRACE_CONT, tid, 0, stopped ? (status[0]! >> 8) & 0xff : 0);
    }
    ptrace(PTRACE_POKEUSER, tid, DEBUG_REGISTERS + 7 * 8, 0);
    ptrace(PTRACE_DETACH, tid, 0, 0);
  };
  try {
    call("PTRACE_INTERRUPT", ptrace(PTRACE_INTERRUPT, tid, 0, 0));
    if (wait(0) !== tid) throw new Error(`thread ${tid} didn't stop for the watchpoint`);
    call("set DR0", ptrace(PTRACE_POKEUSER, tid, DEBUG_REGISTERS, address));
    call("set DR7", ptrace(PTRACE_POKEUSER, tid, DEBUG_REGISTERS + 7 * 8, DR7_WRITE_4));
    call("PTRACE_CONT", ptrace(PTRACE_CONT, tid, 0, 0));
    const deadline = performance.now() + seconds * 1000;
    while (hits < limit && performance.now() < deadline) {
      const waited = wait(WNOHANG);
      if (waited === 0) {
        Bun.sleepSync(1);
        continue;
      }
      if (waited !== tid) throw new Error(`thread ${tid} is gone`);
      const value = status[0]!;
      if ((value & 0xff) !== 0x7f) throw new Error(`thread ${tid} exited (status 0x${value.toString(16)})`);
      const signal = (value >> 8) & 0xff;
      const event = value >> 16;
      // DR6 bit 0: DR0's watchpoint fired. Any other SIGTRAP belongs to the game.
      const ours = signal === SIGTRAP && event === 0 && (Number(ptrace(PTRACE_PEEKUSER, tid, DEBUG_REGISTERS + 6 * 8, 0)) & 1) === 1;
      if (ours) {
        ptrace(PTRACE_POKEUSER, tid, DEBUG_REGISTERS + 6 * 8, 0);
        hits++;
        onHit(hits);
        call("PTRACE_CONT", ptrace(PTRACE_CONT, tid, 0, 0));
      } else {
        // Wine's own signals and group stops pass through untouched.
        call("PTRACE_CONT", ptrace(PTRACE_CONT, tid, 0, event === 0 ? signal : 0));
      }
    }
  } finally {
    detach();
  }
  return hits;
}
