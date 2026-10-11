import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Schema } from "effect";
import { LanFailure } from "./join";
import { UsageFailure, flagValues, wholeFlag } from "../command";
import { writeAtomic } from "../files";
import { cacheHome, dataHome, stateHome } from "../xdg";
import { InputInjection } from "../../platform/services";
import { documentsFolder } from "../../warcraft/battleNet";

export const stateRoot = () => join(stateHome(), "wisp/lan");
export const dataRoot = () => join(dataHome(), "wisp/lan");
export const mapPackager = () => join(cacheHome(), "wisp/lan/map-pack");

export const PAIR_SIDES = ["a", "b"] as const;
export type Side = (typeof PAIR_SIDES)[number];

export const clientName = (pair: number, side: Side) => `lan${pair}${side}`;

export const reportPort = (pair: number, side: Side) => 47200 + pair * 2 + PAIR_SIDES.indexOf(side);

export const clientRoot = (name: string) => join(dataRoot(), "clients", name);
export const prefixOf = (name: string) => join(clientRoot(name), "pfx");
export const installOf = (name: string) => join(prefixOf(name), "drive_c/Program Files (x86)/Warcraft III");
export const retailOf = (name: string) => join(installOf(name), "_retail_");
export const exeOf = (name: string) => join(retailOf(name), "x86_64/Warcraft III.exe");
export const documentsOf = (name: string) => documentsFolder(prefixOf(name));
export const pairDirectory = (pair: number) => join(stateRoot(), `pair-${pair}`);

export const audioSinkOf = (name: string) => `wisp-lan-${name}`;

export const agentSocket = (pair: number) => join(pairDirectory(pair), "agent.sock");

export interface Profile {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly maxFps: number;

  readonly video: Readonly<Record<string, number>>;

  readonly graphicsMode: "classic" | "reforged" | "definitive";

  readonly sound: boolean;

  readonly music: boolean;
}

const LOWEST: Readonly<Record<string, number>> = {
  antialiasing: 0, assao: 0, foliagequality: 0, lightingquality: 0, pointlightshadowquality: 0,
  shadowquality: 0, texquality: 0, waterquality: 0, vsync: 0,
};

const PARITY: Profile = { name: "parity", width: 800, height: 600, maxFps: 60, video: LOWEST, graphicsMode: "classic", sound: false, music: false };
const VISUAL: Profile = { name: "visual", width: 1280, height: 720, maxFps: 60, video: { ...LOWEST, lightingquality: 2, texquality: 1 }, graphicsMode: "reforged", sound: true, music: true };
const CAPTURE_VIDEO = { ...LOWEST, lightingquality: 2, texquality: 1, shadowquality: 2, pointlightshadowquality: 2, waterquality: 2, assao: 1 };
const captureProfile = (graphicsMode: Profile["graphicsMode"]): Profile => ({ ...VISUAL, name: `capture-${graphicsMode}`, video: CAPTURE_VIDEO, graphicsMode, sound: true, music: false });
const CAPTURE_PROFILES = {
  "capture-classic": captureProfile("classic"),
  "capture-reforged": captureProfile("reforged"),
  "capture-definitive": captureProfile("definitive"),
};
export const PROFILES: Readonly<Record<string, Profile>> = {
  parity: PARITY,
  checks: { name: "checks", width: 800, height: 600, maxFps: 60, video: LOWEST, graphicsMode: "classic", sound: true, music: false },

  hfr: { name: "hfr", width: 800, height: 600, maxFps: 144, video: LOWEST, graphicsMode: "classic", sound: false, music: false },
  visual: { ...VISUAL, graphicsMode: "classic" },
  "capture-classic": CAPTURE_PROFILES["capture-classic"],
};

export function poolProfile(name: string, fps?: number): Profile {
  const profile = PROFILES[name];
  if (profile === undefined) throw new Error(`unknown pool profile ${name}`);
  if (fps !== undefined && (!Number.isInteger(fps) || fps < 1)) throw new Error("--fps takes a positive whole number");
  return fps === undefined ? profile : { ...profile, maxFps: fps };
}

/** The pair and pool profile (`--pair K --pool-profile NAME [--fps N]`) that `wisp lan pool` starts a pair's session and agent with. */
export function pairFlags(argv: readonly string[]): { readonly pair: number; readonly profile: Profile } {
  const pair = wholeFlag(argv, "pair", { fallback: 0 });
  const fps = wholeFlag(argv, "fps", { min: 1 });
  if (pair instanceof UsageFailure) throw pair;
  if (fps instanceof UsageFailure) throw fps;
  return { pair, profile: poolProfile(flagValues(argv, "pool-profile")[0] ?? "parity", fps) };
}

export function profileSections(profile: Profile, windowX: number): Record<string, Record<string, number>> {
  const video: Record<string, number> = {
    ...profile.video,
    adapter: 0,
    backgroundmaxfps: profile.maxFps,
    colordepth: 32,
    gamma: 30,
    maxfps: profile.maxFps,
    previouswindowmode: 0,
    refreshrate: 60,
    resetdefaults: 0,
    reswidth: profile.width,
    resheight: profile.height,
    supersampling: 100,
    windowmode: 0,
    windowwidth: profile.width,
    windowheight: profile.height,
    windowx: windowX,
    windowy: 0,
  };
  const sound = profile.sound ? 1 : 0;
  return {
    Video: video,
    Misc: { hd: { classic: 0, reforged: 1, definitive: 2 }[profile.graphicsMode] },
    Sound: { ambient: sound, environmental: sound, movement: sound, music: profile.music ? 1 : 0, positional: sound, sfx: sound, unit: sound, nosoundwarn: 1 },
  };
}

export function preferences(profile: Profile, windowX: number): string {
  return Object.entries(profileSections(profile, windowX)).map(([name, values]) => `[${name}]\n${Object.keys(values).sort().map((key) => `${key}=${values[key]}`).join("\n")}\n`).join("\n");
}

export const CLIENT_PROFILES = {
  minimal: { ...PARITY, name: "minimal" },
  visual: VISUAL,
  ...CAPTURE_PROFILES,
  player: { name: "player", width: 1920, height: 1080, maxFps: 60, video: { ...LOWEST, lightingquality: 2 }, graphicsMode: "reforged", sound: true, music: true },
} as const satisfies Readonly<Record<string, Profile>>;
export type ClientProfile = keyof typeof CLIENT_PROFILES;
export const CLIENT_PROFILE_NAMES = Object.keys(CLIENT_PROFILES) as readonly ClientProfile[];

export const profileOf = (client: { readonly profile?: ClientProfile | undefined; readonly offline?: boolean | undefined }) =>
  client.offline === true ? "pool" : client.profile ?? "minimal";

export const profilesLine = (clients: readonly { readonly name: string; readonly profile?: ClientProfile | undefined; readonly offline?: boolean | undefined }[]) =>
  `graphics profiles: ${clients.map((client) => `${client.name}=${profileOf(client)}`).join(" ")}`;

export const measurementRefusal = (clients: readonly { readonly name: string; readonly profile?: ClientProfile | undefined; readonly offline?: boolean | undefined }[]) => {
  const others = clients.filter((client) => profileOf(client) !== "player");
  return others.length === 0 ? undefined : `performance and frame-pacing measurements run under the player graphics profile, and ${others.map((client) => `${client.name} runs ${profileOf(client)}`).join(", ")}: set "profile": "player" in the clients file and restart the client`;
};

export const clientSettings = (profile: ClientProfile): Record<string, Record<string, string>> =>
  Object.fromEntries(Object.entries(profileSections(CLIENT_PROFILES[profile], 0)).map(([section, values]) => [section, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))]));

export const desktopSize = (profile: Profile) => `${profile.width + 40}x${profile.height + 40}`;

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

export function pairClients(pair: number, runs: Readonly<Partial<Record<Side, string>>>): PoolClient[] {
  return PAIR_SIDES.map((side) => {
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

/** Whether a pair is driven at `now`, and since when it has been idle: the latest of the agent's start `started`, its last `wisp lan end` `ended` and its driver's `goneAt`. */
export function idleness(started: string, ended: string | undefined, driver: Driver | undefined, now: number): { readonly state: "busy" | "idle"; readonly idleSince: string; readonly idleSeconds: number } {
  const since = Math.max(Date.parse(started), ended === undefined ? -Infinity : Date.parse(ended), driver?.goneAt === undefined ? -Infinity : Date.parse(driver.goneAt));
  const busy = driver !== undefined && driver.goneAt === undefined;
  return { state: busy ? "busy" : "idle", idleSince: new Date(since).toISOString(), idleSeconds: busy ? 0 : Math.max(0, Math.floor((now - since) / 1000)) };
}

export function pairOf(pool: PoolFile, names: readonly string[]): PoolPair | undefined {
  return pool.pairs.find(({ id }) => names.every((name) => PAIR_SIDES.some((side) => clientName(id, side) === name)));
}
