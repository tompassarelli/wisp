// Putting one offline client into a LAN game (wisp:docs/lan.md): switch its
// provider to TCPN for one rebuild (provider.ts), then list LAN games through
// its menus and join the one named. The switch lasts until the provider is
// rebuilt again (leaving a LAN lobby or game does that), so it runs before
// every join.
import { readFileSync } from "node:fs";
import { Effect, Schedule, Schema } from "effect";
import { findImageBase, parseMaps, procMemory, readExecutable } from "./memory";
import type { MenuSocket } from "../menus";
import { isolatedNetworkProblem } from "./offline";
import { type CodeSpan, KNOWN_BUILDS, LOOP, TCPN, processMemory, providerName, scanCode, stoppedPc, threadStates } from "./provider";

export class LanFailure extends Schema.TaggedError<LanFailure>()("LanFailure", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

const fail = (problem: string) => Effect.fail(new LanFailure({ problem }));
const attempt = <A>(what: string, run: () => A) => Effect.try({ try: run, catch: (cause) => new LanFailure({ problem: `${what}: ${cause instanceof Error ? cause.message : String(cause)}` }) });

/** The readable, decrypted spans of the game image's .text in `pid`. */
export function codeSpans(pid: number, exePath: string): CodeSpan[] {
  const exe = readExecutable(exePath);
  const text = exe.header.sections.find(({ name }) => name === ".text");
  if (text === undefined) throw new Error(`${exePath} has no .text`);
  const maps = parseMaps(readFileSync(`/proc/${pid}/maps`, "latin1")).sort((x, y) => x.start - y.start);
  const memory = procMemory(pid);
  try {
    const base = findImageBase(maps, memory, exe.header);
    if (base === undefined) throw new Error(`pid ${pid} maps no image of ${exePath}`);
    const low = base + text.rva;
    const high = low + text.virtualSize;
    return maps.filter(({ start, end, permissions }) => start < high && end > low && permissions.startsWith("r-x")).map(({ start, end }) => {
      const from = Math.max(start, low);
      return { start: from, bytes: memory.read(from, Math.min(end, high) - from) };
    });
  } finally {
    memory.close();
  }
}

const allStopped = (pid: number) => [...threadStates(pid).values()].every((state) => state === "T" || state === "t");

/**
 * Runs `use` with every thread of `pid` stopped: SIGSTOP is the acquire step
 * and SIGCONT its release, so the game is let go even when its threads don't
 * all stop within a second and `use` never runs. `stopped` reads whether they have.
 */
export const whileStopped = <A, E, R>(pid: number, use: Effect.Effect<A, E, R>, stopped: (pid: number) => boolean = allStopped) => Effect.acquireUseRelease(
  Effect.sync(() => process.kill(pid, "SIGSTOP")),
  () => attempt(`stop pid ${pid}`, () => stopped(pid)).pipe(
    Effect.repeat({ schedule: Schedule.spaced("1 millis"), until: (done) => done }),
    Effect.timeoutOrElse({ duration: "1 second", orElse: () => fail(`stop pid ${pid}: its threads didn't stop within a second`) }),
    Effect.andThen(use),
  ),
  () => Effect.sync(() => process.kill(pid, "SIGCONT")),
);

const threadPcs = (pid: number) => [...threadStates(pid).keys()].map((tid) => {
  try {
    return stoppedPc(readFileSync(`/proc/${pid}/task/${tid}/syscall`, "latin1"));
  } catch {
    return undefined;
  }
});

export interface Switch {
  readonly address: number;
  readonly before: string;
  readonly after: string;
}

/** Writes `to` over `from` at `address` with the game stopped and no thread on the instruction. */
const patchStopped = (pid: number, address: number, from: Buffer, to: Buffer) => whileStopped(
  pid,
  attempt(`patch 0x${address.toString(16)}`, () => {
    if (threadPcs(pid).some((pc) => pc !== undefined && pc >= address - 6 && pc < address + 4)) throw new Error("a thread is on the selector");
    const memory = processMemory(pid);
    try {
      const before = memory.read(address, 4);
      if (!before.equals(from)) throw new Error(`expected ${providerName(from)} (${from.toString("hex")}), found ${before.toString("hex")}; refusing`);
      memory.write(address, to);
      const after = memory.read(address, 4);
      if (!after.equals(to)) throw new Error(`wrote ${to.toString("hex")} but read back ${after.toString("hex")}`);
      return { address, before: before.toString("hex"), after: after.toString("hex") } satisfies Switch;
    } finally {
      memory.close();
    }
  }),
);

/**
 * Switches `pid`'s network provider to TCPN: with the game stopped, TCPN over
 * the selector's LOOP; the menus ask for a provider rebuild; LOOP back at once.
 * Refuses an unknown build, a client with any network but loopback, and a
 * selector that isn't exactly one LOOP.
 */
export const enableLan = (pid: number, exePath: string, version: string, menus: MenuSocket, log: (line: string) => void) => Effect.gen(function*() {
  if (!KNOWN_BUILDS.includes(version)) return yield* fail(`Warcraft III ${version} isn't a build the LAN switch was checked on (${KNOWN_BUILDS.join(", ")})`);
  const online = isolatedNetworkProblem(pid);
  if (online !== undefined) return yield* fail(`refusing to switch pid ${pid}: ${online}`);
  const rebuild = Effect.gen(function*() {
    yield* menus.forget;
    yield* menus.send("InitializeLocalNetProvider");
    yield* menus.expect("rebuild the network provider", 10, (event) => (event.messageType === "OnNetProviderChanged" ? { done: event.payload } : undefined));
  }).pipe(Effect.mapError((failure) => new LanFailure({ problem: failure.message })));
  let found = yield* attempt("read the game's code", () => scanCode(codeSpans(pid, exePath)));
  if (found.selectors.length !== 1 || found.factories.length === 0) {
    // Pages the game hasn't run lately are encrypted again; a rebuild runs (and decrypts) both.
    yield* rebuild;
    found = yield* attempt("read the game's code", () => scanCode(codeSpans(pid, exePath)));
  }
  if (found.factories.length === 0) return yield* fail("the provider factory isn't in the decrypted code; this build may not make a TCPN provider");
  if (found.selectors.length !== 1) return yield* fail(`${found.selectors.length} provider selectors match; refusing`);
  const site = found.selectors[0];
  if (site === undefined) return yield* fail("no provider selector");
  if (site.operand.equals(TCPN)) {
    log(`selector at 0x${site.address.toString(16)} was left on TCPN; restoring LOOP first`);
    yield* patchStopped(pid, site.address, TCPN, LOOP);
  }
  const on = yield* patchStopped(pid, site.address, LOOP, TCPN);
  log(`pid ${pid} selector 0x${on.address.toString(16)}: ${on.before} (LOOP) -> ${on.after} (TCPN)`);
  const rebuilt = yield* Effect.exit(rebuild);
  const off = yield* patchStopped(pid, site.address, TCPN, LOOP);
  log(`pid ${pid} selector 0x${off.address.toString(16)}: ${off.before} (TCPN) -> ${off.after} (LOOP)`);
  if (rebuilt._tag === "Failure") return yield* fail(`the game didn't rebuild its provider while switched; nothing changed (${String(rebuilt.cause)})`);
});

interface ListedGame {
  readonly id: number;
  readonly name: string;
  readonly mapFile?: string;
}

const listedGames = (payload: unknown): ListedGame[] => {
  const games = typeof payload === "object" && payload !== null ? (payload as { games?: unknown }).games : undefined;
  return Array.isArray(games) ? games.filter((game): game is ListedGame => typeof game === "object" && game !== null && typeof (game as ListedGame).name === "string") : [];
};

/** Lists LAN games every second until `gameName` appears, then joins it. */
export const joinLanGame = (menus: MenuSocket, gameName: string, seconds = 30) => Effect.gen(function*() {
  yield* menus.forget;
  yield* menus.send("SendGameListing");
  const listed = Effect.gen(function*() {
    yield* menus.send("GetGameList");
    const games = yield* menus.expect("list LAN games", 3, (event) => (event.messageType === "GameList" ? { done: listedGames(event.payload) } : undefined)).pipe(Effect.orElseSucceed((): ListedGame[] => []));
    return games.find(({ name }) => name === gameName);
  });
  const game = yield* listed.pipe(
    Effect.repeat({ schedule: Schedule.spaced("1 second"), until: (found) => found !== undefined }),
    Effect.timeoutOrElse({ duration: `${seconds} seconds`, orElse: () => fail(`no LAN game named ${gameName} listed within ${seconds} s`) }),
  );
  if (game !== undefined) yield* menus.send("JoinGame", { gameId: game.id, password: "", mapFile: game.mapFile });
}).pipe(Effect.mapError((failure) => (failure instanceof LanFailure ? failure : new LanFailure({ problem: failure.message }))));
