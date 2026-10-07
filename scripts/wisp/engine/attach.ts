// The only way the engine tools open a game process, and its guardrails
// (wisp:docs/engine.md#guardrails). These tools are for debugging your own
// map on your own development clients, never for cheating or touching
// other players' games:
// - Only clients the project's clients file declares, found by their Wine
//   prefix, and only processes of this user. No arbitrary process IDs, and
//   never a game on the owner's own display (a `wisp play` session can
//   share a development client's prefix).
// - Two tiers of access. "read" (read-only /proc/PID/mem: poll, locate) is
//   passive and out of process, so it may follow an online dev client.
//   "trap" (perf hardware breakpoints: watch) sets the process's debug
//   registers, which code inside the process can observe, so it needs a
//   verifiably offline client: a network namespace with only loopback, no
//   Battle.net program in its prefix, no Battle.net session argument (`-uid`)
//   and no connection to an address outside this machine.
// - Nothing writes to a game process, stops it, attaches a debugger or
//   injects code; no command offers that.
import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { type GameExecutable, type Mapping, type Memory, PTRACE_SCOPE, findGameProcesses, findImageBase, memoryAccessProblem, parseMaps, procMemory, readExecutable } from "./memory";

/** A dev client, as the project's clients file declares it: its name and Wine prefix. */
export interface EngineClient {
  readonly name: string;
  readonly prefix: string;
}

/** A running client opened for reading. */
export interface AttachedClient {
  readonly name: string;
  readonly pid: number;
  readonly exe: GameExecutable;
  readonly memory: Memory & { readonly close: () => void };
  readonly maps: Mapping[];
  readonly base: number;
}

export interface Connection {
  readonly protocol: "tcp" | "udp";
  readonly remote: string;
  readonly remotePort: number;
  /** /proc/net/tcp's state: 1 is established. */
  readonly state: number;
  readonly inode: number;
}

/** /proc/PID/net/{tcp,tcp6,udp,udp6} rows. */
export function parseSocketTable(text: string, protocol: Connection["protocol"]): Connection[] {
  return text.split("\n").slice(1).flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    const remote = fields[2];
    if (remote === undefined || fields[9] === undefined) return [];
    const [address = "", port = "0"] = remote.split(":");
    return [{ protocol, remote: tcpAddress(address), remotePort: Number.parseInt(port, 16), state: Number.parseInt(fields[3] ?? "0", 16), inode: Number(fields[9]) }];
  });
}

/** /proc/net/tcp's hex address (little-endian words) as text: `0100007F` → `127.0.0.1`. */
export function tcpAddress(hex: string): string {
  const words = hex.match(/.{8}/g) ?? [];
  const bytes = words.flatMap((word) => (word.match(/../g) ?? []).reverse().map((byte) => Number.parseInt(byte, 16)));
  if (bytes.length === 4) return bytes.join(".");
  // IPv4-mapped IPv6.
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12).join(".");
  const groups: string[] = [];
  for (let index = 0; index < bytes.length; index += 2) groups.push((((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0)).toString(16));
  return groups.join(":");
}

/** Loopback, private, link-local or unspecified: this machine or its local network. */
export function isLocalAddress(address: string): boolean {
  if (address.includes(":")) return address === "0:0:0:0:0:0:0:0" || address === "0:0:0:0:0:0:0:1" || /^f[cd]/.test(address) || /^fe[89ab]/.test(address);
  const [a = -1, b = -1] = address.split(".").map(Number);
  return a === 0 || a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export interface ProcessView {
  readonly pid: number;
  /** NUL-separated arguments. */
  readonly commandLine: string;
  /** Other processes' command lines in the same Wine prefix. */
  readonly prefixCommandLines: readonly string[];
  /** Socket inodes the process holds. */
  readonly sockets: ReadonlySet<number>;
  readonly connections: readonly Connection[];
  /** Network interfaces in the process's network namespace, from /proc/PID/net/dev. */
  readonly interfaces: readonly string[];
}

/** Interface names in /proc/PID/net/dev. */
export function parseInterfaces(text: string): string[] {
  return text.split("\n").slice(2).flatMap((line) => {
    const name = /^\s*([^:\s]+):/.exec(line)?.[1];
    return name === undefined ? [] : [name];
  });
}

const BATTLE_NET = /(?:^|[\\/])(?:Battle\.net(?: Launcher)?|Agent|BlizzardBrowser|Blizzard Battle\.net)\.exe/i;

/** Why `view`'s process may be online, or undefined when it is verifiably offline. */
export function onlineProblem(view: ProcessView): string | undefined {
  const args = view.commandLine.split("\0");
  if (args.some((arg) => arg.startsWith("-uid"))) return `pid ${view.pid} was started by Battle.net (${args.slice(1).filter((arg) => arg !== "").join(" ")})`;
  const launcher = view.prefixCommandLines.find((line) => BATTLE_NET.test(line.split("\0")[0] ?? ""));
  if (launcher !== undefined) return `Battle.net runs in this client's prefix (${(launcher.split("\0")[0] ?? "").split("\\").pop()})`;
  // An established TCP connection, or a UDP socket connected to a peer, outside the local network.
  const remote = view.connections.find(({ protocol, state, inode, remote: address, remotePort }) =>
    view.sockets.has(inode) && !isLocalAddress(address) && (protocol === "tcp" ? state === 1 : remotePort !== 0));
  if (remote !== undefined) return `pid ${view.pid} has a ${remote.protocol} connection to ${remote.remote}:${remote.remotePort}`;
  // Proof of offline: a network namespace that can reach nothing but itself.
  const outside = view.interfaces.filter((name) => name !== "lo");
  if (view.interfaces.length === 0 || outside.length > 0) return `pid ${view.pid}'s network namespace has ${outside.length > 0 ? `interfaces ${outside.join(", ")}` : "no readable interface list"}; an offline client runs in one with only loopback`;
  return undefined;
}

/** The process as onlineProblem reads it, from /proc. */
export function viewProcess(pid: number, prefix: string, prefixPids: readonly number[]): ProcessView {
  const read = (path: string) => {
    try {
      return readFileSync(path, "latin1");
    } catch {
      return "";
    }
  };
  const sockets = new Set<number>();
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    try {
      const target = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`));
      if (target !== null) sockets.add(Number(target[1]));
    } catch {
      // Descriptors close while they are listed.
    }
  }
  return {
    pid,
    commandLine: read(`/proc/${pid}/cmdline`),
    prefixCommandLines: [...processesInPrefix(prefix)].filter((other) => other !== pid && !prefixPids.includes(other)).map((other) => read(`/proc/${other}/cmdline`)),
    sockets,
    interfaces: parseInterfaces(read(`/proc/${pid}/net/dev`)),
    connections: (["tcp", "udp"] as const).flatMap((protocol) => [...parseSocketTable(read(`/proc/${pid}/net/${protocol}`), protocol), ...parseSocketTable(read(`/proc/${pid}/net/${protocol}6`), protocol)]),
  };
}

/** This user's processes whose WINEPREFIX is `prefix`. */
function* processesInPrefix(prefix: string): Generator<number> {
  const wanted = prefix.replace(/\/+$/, "");
  const uid = process.getuid?.();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (uid !== undefined && statSync(`/proc/${entry}`).uid !== uid) continue;
      const environment = readFileSync(`/proc/${entry}/environ`, "latin1").split("\0");
      if (environment.some((variable) => variable.replace(/\/+$/, "") === `WINEPREFIX=${wanted}`)) yield Number(entry);
    } catch {
      // Processes come and go while /proc is listed.
    }
  }
}

/** Whether this process is an ancestor of `pid`: Yama's ptrace_scope 1 lets an ancestor (the launcher) read it. */
export function isAncestorOf(pid: number): boolean {
  for (let current = pid, steps = 0; current > 1 && steps < 64; steps++) {
    let parent: number;
    try {
      parent = Number(/^PPid:\s+(\d+)$/m.exec(readFileSync(`/proc/${current}/status`, "latin1"))?.[1] ?? 0);
    } catch {
      return false;
    }
    if (parent === process.pid) return true;
    current = parent;
  }
  return false;
}

export type EngineAccess = "read" | "trap";

/** The owner's own desktop: games there are the owner's play, not development clients. */
export const OWNER_DISPLAY = ":0";

/** Why the process with this environment (NUL-separated) is the owner's own game, or undefined. */
export function ownerProblem(environment: string): string | undefined {
  const display = environment.split("\0").find((variable) => variable.startsWith("DISPLAY="))?.slice("DISPLAY=".length);
  return display === OWNER_DISPLAY ? `it runs on the owner's display ${OWNER_DISPLAY}, so it is the owner's game, not a development client` : undefined;
}

/**
 * Opens the client's one Warcraft III.exe, or says why it won't: "read"
 * needs read access to its memory (Yama allows it at ptrace_scope 0, to an
 * ancestor, or into a user namespace this user owns, as Proton's
 * pressure-vessel makes); "trap" also needs the client verifiably offline.
 */
export function attachClient({ name, prefix }: EngineClient, access: EngineAccess = "read"): AttachedClient | string {
  const processes = findGameProcesses(prefix);
  const game = processes[0];
  if (game === undefined) return `client ${name}: no Warcraft III.exe of this user running in ${prefix}`;
  if (processes.length > 1) return `client ${name}: ${processes.length} Warcraft III.exe processes share ${prefix} (pids ${processes.map(({ pid }) => pid).join(", ")})`;
  let environment = "";
  try {
    environment = readFileSync(`/proc/${game.pid}/environ`, "latin1");
  } catch {
    return `client ${name}: can't read pid ${game.pid}'s environment`;
  }
  const owner = ownerProblem(environment);
  if (owner !== undefined) return `client ${name}: refusing pid ${game.pid}: ${owner}`;
  if (access === "trap") {
    const online = onlineProblem(viewProcess(game.pid, prefix, []));
    if (online !== undefined) return `client ${name}: breakpoints need an offline client, and this one may be online: ${online} (wisp:docs/engine.md#guardrails)`;
  }
  const exe = readExecutable(game.exe);
  const maps = parseMaps(readFileSync(`/proc/${game.pid}/maps`, "latin1")).sort((x, y) => x.start - y.start);
  let memory: ReturnType<typeof procMemory>;
  try {
    memory = procMemory(game.pid);
    const first = maps.find(({ permissions }) => permissions.startsWith("r"));
    if (first !== undefined) memory.read(first.start, 1);
  } catch (cause) {
    let scope: string | undefined;
    try {
      scope = readFileSync(PTRACE_SCOPE, "utf8");
    } catch {
      scope = undefined;
    }
    return `client ${name}: can't read pid ${game.pid}'s memory (${cause instanceof Error ? cause.message : String(cause)})${scope === undefined ? "" : `. ${memoryAccessProblem(scope) ?? ""}`}`;
  }
  const base = findImageBase(maps, memory, exe.header);
  if (base === undefined) {
    memory.close();
    return `client ${name}: pid ${game.pid} maps no image of ${game.exe} (still starting?)`;
  }
  return { name, pid: game.pid, exe, memory, maps, base };
}
