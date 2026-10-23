import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Duration, Effect, Schema } from "effect";
import { LanFailure } from "./join";
import { UsageFailure, flagValues, wholeFlag } from "../cli/command";
import { pollUntil } from "../cli/hostProcess";
import { writeAtomic } from "../io/files";
import { cacheHome, dataHome, stateHome } from "../io/xdg";
import { InputInjection } from "../os/platform/services";
import { documentsFolder } from "../os/warcraft/battleNet";
import { PROFILES, type Profile } from "../os/warcraft/clientProfiles";
export {
  CLIENT_PROFILE_NAMES, type ClientProfile, PROFILES, type Profile, clientSettings, desktopSize, preferences,
} from "../os/warcraft/clientProfiles";

const stateRoot = () => join(stateHome(), "wisp/lan");
const dataRoot = () => join(dataHome(), "wisp/lan");
export const mapPackager = () => join(cacheHome(), "wisp/lan/map-pack");

export const PAIR_SIDES = ["a", "b"] as const;
export type Side = (typeof PAIR_SIDES)[number];
export const pairSides = (network: boolean): readonly Side[] => (network ? ["a"] : PAIR_SIDES);

export const WINDOW_DEADLINE = "30 seconds";
export const WINDOW_RELAUNCHES = 3;
export const MENUS_DEADLINE = "5 minutes";

export const reachedMenus = (sent: readonly { readonly message: string; readonly payload?: unknown }[]) =>
  sent.some(({ message, payload }) => message === "ScreenTransitionInfo" && typeof payload === "object" && payload !== null && "screen" in payload && payload.screen === "LOGIN_DOORS");

export const launchUntilShown = <A, E, R>(start: {
  readonly launch: Effect.Effect<A, E, R>;
  readonly shown: (launched: A) => Effect.Effect<boolean, E, R>;
  readonly stop: (launched: A) => Effect.Effect<void, E, R>;
  readonly relaunching: (launches: number) => Effect.Effect<void, E, R>;
  readonly exhausted: (launches: number) => E;
}): Effect.Effect<A, E, R> => {
  const attempt = (launches: number): Effect.Effect<A, E, R> => Effect.gen(function*() {
    const launched = yield* start.launch;
    if (yield* start.shown(launched)) return launched;
    yield* start.stop(launched);
    if (launches > WINDOW_RELAUNCHES) return yield* Effect.fail(start.exhausted(launches));
    yield* start.relaunching(launches);
    return yield* attempt(launches + 1);
  });
  return attempt(1);
};

export const clientName = (pair: number, side: Side) => `lan${pair}${side}`;

export const reportPort = (pair: number, side: Side) => 47200 + pair * 2 + PAIR_SIDES.indexOf(side);

export const clientRoot = (name: string) => join(dataRoot(), "clients", name);
export const prefixOf = (name: string) => join(clientRoot(name), "pfx");
export const installOf = (name: string) => join(prefixOf(name), "drive_c/Program Files (x86)/Warcraft III");
export const retailOf = (name: string) => join(installOf(name), "_retail_");
export const exeOf = (name: string) => join(retailOf(name), "x86_64/Warcraft III.exe");
export const documentsOf = (name: string) => documentsFolder(prefixOf(name));
export const pairDirectory = (pair: number) => join(stateRoot(), `pair-${pair}`);

export const poolHolderFile = (pair: number) => join(pairDirectory(pair), "pool.pid");

const poolLockFile = (pair: number) => join(pairDirectory(pair), "pool.lock");

export const pairCustody = (pair: number) => Effect.gen(function*() {
  yield* Effect.try({
    try: () => mkdirSync(pairDirectory(pair), { recursive: true }),
    catch: (cause) => new LanFailure({ problem: `create pair ${pair}: ${String(cause)}` }),
  });
  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () => Bun.spawn(["flock", "--exclusive", "--nonblock", "--no-fork", poolLockFile(pair), "sh", "-c", "echo held; exec cat >/dev/null"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" }),
      catch: (cause) => new LanFailure({ problem: `lock pair ${pair}: ${String(cause)}` }),
    }),
    (child) => Effect.promise(async () => {
      child.stdin.end();
      await child.exited;
    }),
  );
  const ready = yield* Effect.tryPromise({
    try: () => child.stdout.getReader().read(),
    catch: (cause) => new LanFailure({ problem: `lock pair ${pair}: ${String(cause)}` }),
  });
  if (ready.done) {
    const code = yield* Effect.promise(() => child.exited);
    if (code !== 1) return yield* new LanFailure({ problem: `flock pair ${pair} exited ${code}: ${(yield* Effect.promise(() => new Response(child.stderr).text())).trim()}` });
    const holder = yield* Effect.try(() => readFileSync(poolHolderFile(pair), "utf8").trim()).pipe(Effect.orElseSucceed(() => "taking custody"));
    return yield* new LanFailure({ problem: `it is held by wisp lan pool ${holder}; stop that pool first` });
  }
});

const PlaytestState = Schema.fromJsonString(Schema.Struct({ on: Schema.Boolean }));

export const playtestPairRefusal = (pair: number) => Effect.gen(function*() {
  const file = process.env["PLAYTEST_STATE"] ?? join(homedir(), ".local/state/playtest/state.json");
  if (!existsSync(file)) return undefined;
  const state = yield* Effect.try({
    try: () => readFileSync(file, "utf8"),
    catch: (cause) => new LanFailure({ problem: `read ${file}: ${String(cause)}` }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(PlaytestState)),
    Effect.mapError((cause) => cause instanceof LanFailure ? cause : new LanFailure({ problem: `${file}: ${cause.message}` })),
  );
  if (!state.on) return undefined;
  const held = yield* Effect.try({
    try: () => readdirSync(stateRoot()).filter((name) => /^pair-\d+$/.test(name) && name !== `pair-${pair}`).some((name) => {
      const holder = join(stateRoot(), name, "pool.pid");
      try {
        const pid = Number(readFileSync(holder, "utf8").trim());
        return Number.isInteger(pid) && pid > 0 && alive(pid);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw cause;
      }
    }),
    catch: (cause) => new LanFailure({ problem: `read LAN pair holders: ${String(cause)}` }),
  });
  return held ? "playtest is on: the laptop LAN pool admits at most one pair; run additional work on Nexus or the Warcraft VM" : undefined;
});

export const audioSinkOf = (name: string) => `wisp-lan-${name}`;

export const agentSocket = (pair: number) => join(pairDirectory(pair), "agent.sock");

function poolProfile(name: string, fps?: number): Profile {
  const profile = PROFILES[name];
  if (profile === undefined) throw new Error(`unknown pool profile ${name}`);
  if (fps !== undefined && (!Number.isInteger(fps) || fps < 1)) throw new Error("--fps takes a positive whole number");
  return fps === undefined ? profile : { ...profile, maxFps: fps };
}

/** The pair and pool profile (`--pair K --pool-profile NAME [--fps N]`) that `wisp lan pool` starts a pair's session and agent with. */
export function pairFlags(argv: readonly string[]): { readonly pair: number; readonly profile: Profile; readonly network: boolean } {
  const pair = wholeFlag(argv, "pair", { fallback: 0 });
  const fps = wholeFlag(argv, "fps", { min: 1 });
  if (pair instanceof UsageFailure) throw pair;
  if (fps instanceof UsageFailure) throw fps;
  return { pair, profile: poolProfile(flagValues(argv, "pool-profile")[0] ?? "parity", fps), network: argv.includes("--network") };
}

export function networkFlagProblem(args: readonly string[]): string | undefined {
  if (!args.includes("--network")) return undefined;
  if (flagValues(args, "pairs").length > 0 || flagValues(args, "pair").length !== 1) return "--network opens one pair's network for solo games; name exactly one --pair K";
  return undefined;
}

export const lanPlayRefusal = (pair: number, network: boolean, command: "fresh" | "dummy" | "netem") =>
  network ? `pair ${pair} was started with --network for solo games; lan ${command} runs only on an offline pair` : undefined;

export interface PoolClient {
  readonly name: string;
  readonly documents: string;
  readonly menuReportPort: number;
  readonly pair: number;
  readonly offline: true;
  readonly run?: string;
}

export interface PoolPair {
  readonly id: number;
  readonly clients: string;
  readonly agentSocket: string;

  readonly runs: Readonly<Partial<Record<Side, string>>>;
  readonly appIds: Readonly<Record<Side, string>>;
  readonly network?: boolean;
}

export interface PoolFile {
  readonly profile: string;
  readonly pairs: readonly PoolPair[];
  readonly owner?: { readonly uid: number; readonly user: string };
}

export const poolFile = () => join(stateRoot(), "pool.json");

export const poolClientsFile = () => join(stateRoot(), "clients.json");

/** One line per pair whose driver died without `wisp lan end` and stayed gone for ALARM_AFTER_MS, for the owner's tick to read. */
export const alarmLog = () => join(stateRoot(), "alarms.log");

export function pairClients(pair: number, runs: Readonly<Partial<Record<Side, string>>>, sides: readonly Side[]): PoolClient[] {
  return sides.map((side) => {
    const run = runs[side];
    return { name: clientName(pair, side), documents: documentsOf(clientName(pair, side)), menuReportPort: reportPort(pair, side), pair, offline: true as const, ...(run === undefined ? {} : { run }) };
  });
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export const writePoolClients = (path: string, clients: readonly PoolClient[]) => Effect.gen(function*() {
  const tools = yield* (yield* InputInjection).tools;
  writeJson(path, { tools, clients });
});

const PoolFileJson = Schema.fromJsonString(Schema.Struct({
  profile: Schema.String,
  fps: Schema.optionalKey(Schema.Finite),
  owner: Schema.optionalKey(Schema.Struct({ uid: Schema.Int, user: Schema.String })),
  pairs: Schema.Array(Schema.Struct({
    id: Schema.Int,
    clients: Schema.String,
    agentSocket: Schema.String,
    runs: Schema.Struct({ a: Schema.optionalKey(Schema.String), b: Schema.optionalKey(Schema.String) }),
    appIds: Schema.Struct({ a: Schema.String, b: Schema.String }),
    profile: Schema.optionalKey(Schema.String),
    network: Schema.optionalKey(Schema.Boolean),
  })),
}));

const readPoolAt = (file: string): Effect.Effect<PoolFile | undefined, LanFailure> => Effect.suspend(() => {
  // @effect-diagnostics-next-line effectSucceedWithVoid:off -- an undefined result, which Effect.void's void type cannot satisfy
  if (!existsSync(file)) return Effect.succeed(undefined);
  return Effect.try({ try: () => readFileSync(file, "utf8"), catch: (cause) => new LanFailure({ problem: `${file}: ${String(cause)}` }) }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(PoolFileJson)),
    Effect.mapError((cause) => (cause instanceof LanFailure ? cause : new LanFailure({ problem: `${file}: ${cause.message}` }))),
  );
});

export const readPool: Effect.Effect<PoolFile | undefined, LanFailure> = Effect.suspend(() => readPoolAt(poolFile()));

export interface PoolOwner {
  readonly uid: number;
  readonly user: string;
  readonly home?: string;
  readonly pool: string;
}

const shellWord = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);

/** Why user `uid` may not run the `wisp lan` COMMAND (its whole command line) while `owners` hold live pools, or undefined when it may: its pool state and agent sockets are another user's. */
export function wrongUser(uid: number, owners: readonly PoolOwner[], command: readonly string[]): string | undefined {
  const [owner] = owners;
  if (owner === undefined || owners.some((candidate) => candidate.uid === uid)) return undefined;
  return `the running LAN pool (${owner.pool}) belongs to ${owner.user} (uid ${owner.uid}), and its state and agent sockets live under that user's home and runtime directory; run it as that user: sudo -u ${owner.user} env ${owner.home === undefined ? "" : `HOME=${owner.home} `}XDG_RUNTIME_DIR=/run/user/${owner.uid} ${command.map(shellWord).join(" ")}`;
}

/** The owners of every pool with a live pair: this user's own state, and each account's default state directory that this user can read. */
export const poolOwners: Effect.Effect<readonly PoolOwner[]> = Effect.gen(function*() {
  const accounts = yield* Effect.try(() => readFileSync("/etc/passwd", "utf8")).pipe(
    Effect.map((text) => text.split("\n").map((line) => line.split(":")).filter((fields) => fields.length >= 7).map(([user = "", , uid = "", , , home = ""]) => ({ user, uid: Number(uid), home }))),
    Effect.orElseSucceed(() => []),
  );
  const files = [...new Set([poolFile(), ...accounts.filter(({ home }) => home.startsWith("/")).map(({ home }) => join(home, ".local/state/wisp/lan/pool.json"))])];
  const owners = yield* Effect.forEach(files, (file) => readPoolAt(file).pipe(
    Effect.flatMap((pool) => Effect.try(() => {
      if (pool === undefined || !pool.pairs.some(({ agentSocket: socket }) => existsSync(socket))) return undefined;
      const uid = pool.owner?.uid ?? statSync(file).uid;
      const account = accounts.find((candidate) => candidate.uid === uid);
      return { uid, user: pool.owner?.user ?? account?.user ?? `#${uid}`, pool: file, ...(account === undefined ? {} : { home: account.home }) };
    })),
    Effect.orElseSucceed(() => undefined),
  ));
  return owners.filter((owner) => owner !== undefined);
});

/** The process driving a pair through `wisp lan fresh` or `solo`, and when its death was first seen. */
export interface Driver {
  readonly pid: number;
  readonly since: string;
  readonly goneAt?: string;
}

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const ALARM_AFTER_MS = 10 * 60_000;

/** What `wisp lan status` marks on a pair whose driver is `driver` at `now`, and whether its line in the alarm log is due. */
export function driverVerdict(driver: Driver | undefined, now: number): { readonly idle?: string; readonly alarm: boolean } {
  if (driver?.goneAt === undefined) return { alarm: false };
  return { idle: `idle since ${driver.goneAt}, driver gone`, alarm: now - Date.parse(driver.goneAt) >= ALARM_AFTER_MS };
}

/** Whether a pair is dead (a client in `down` has no game process), busy (a live driver or a game in progress, `playing`) or idle at `now`, and since when it has been idle: the latest of the agent's start `started`, its last `wisp lan end` `ended` and its driver's `goneAt`. */
export function idleness(started: string, ended: string | undefined, driver: Driver | undefined, playing: boolean, down: readonly string[], now: number): { readonly state: "dead" | "busy" | "idle"; readonly idleSince: string; readonly idleSeconds: number; readonly down?: readonly string[] } {
  const since = Math.max(Date.parse(started), ended === undefined ? -Infinity : Date.parse(ended), driver?.goneAt === undefined ? -Infinity : Date.parse(driver.goneAt));
  const idleSince = new Date(since).toISOString();
  if (down.length > 0) return { state: "dead", idleSince, idleSeconds: 0, down };
  const busy = playing || (driver !== undefined && driver.goneAt === undefined);
  return { state: busy ? "busy" : "idle", idleSince, idleSeconds: busy ? 0 : Math.max(0, Math.floor((now - since) / 1000)) };
}

export function pairOf(pool: PoolFile, names: readonly string[]): PoolPair | undefined {
  return pool.pairs.find(({ id }) => names.every((name) => PAIR_SIDES.some((side) => clientName(id, side) === name)));
}

export const STOP_GRACE = "10 seconds";

export const stopGame = (stop: {
  readonly terminate: Effect.Effect<void>;
  readonly survivors: Effect.Effect<readonly number[]>;
  readonly kill: (pids: readonly number[]) => Effect.Effect<void>;
  readonly outlived: (pids: readonly number[]) => Effect.Effect<void>;
  readonly grace: Duration.Input;
}): Effect.Effect<void> => {
  const gone = pollUntil(stop.survivors, { until: (left) => left.length === 0, every: "250 millis", within: stop.grace, onTimeout: () => stop.survivors });
  return Effect.gen(function*() {
    yield* stop.terminate;
    const left = yield* gone;
    if (left.length === 0) return;
    yield* stop.outlived(left);
    yield* stop.kill(left);
    yield* pollUntil(stop.survivors, { until: (rest) => rest.length === 0, every: "250 millis", within: "3 seconds", onTimeout: () => Effect.succeed([]) });
  });
};
