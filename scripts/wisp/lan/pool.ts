




import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Schema } from "effect";
import { LanFailure } from "./join";

export const stateRoot = () => join(process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local/state"), "wisp/lan");
export const dataRoot = () => join(process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local/share"), "wisp/lan");

export const PAIR_SIDES = ["a", "b"] as const;
export type Side = (typeof PAIR_SIDES)[number];


export const clientName = (pair: number, side: Side) => `lan${pair}${side}`;

export const reportPort = (pair: number, side: Side) => 47200 + pair * 2 + PAIR_SIDES.indexOf(side);

export const clientRoot = (name: string) => join(dataRoot(), "clients", name);
export const prefixOf = (name: string) => join(clientRoot(name), "pfx");
export const installOf = (name: string) => join(prefixOf(name), "drive_c/Program Files (x86)/Warcraft III");
export const retailOf = (name: string) => join(installOf(name), "_retail_");
export const exeOf = (name: string) => join(retailOf(name), "x86_64/Warcraft III.exe");
export const documentsOf = (name: string) => join(prefixOf(name), "drive_c/users/steamuser/Documents/Warcraft III");
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
}

export const poolFile = () => join(stateRoot(), "pool.json");

export const poolClientsFile = () => join(stateRoot(), "clients.json");

export function pairClients(pair: number, runs: Readonly<Partial<Record<Side, string>>>): PoolClient[] {
  return PAIR_SIDES.map((side) => {
    const run = runs[side];
    return { name: clientName(pair, side), documents: documentsOf(clientName(pair, side)), menuReportPort: reportPort(pair, side), pair, offline: true as const, ...(run === undefined ? {} : { run }) };
  });
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.next`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${path}.next`, path);
}

export function writePoolClients(path: string, clients: readonly PoolClient[]): void {
  writeJson(path, { tools: { grim: "grim", xdotool: "xdotool", wlrctl: "wlrctl", tesseract: "tesseract" }, clients });
}

const PoolFileJson = Schema.fromJsonString(Schema.Struct({
  profile: Schema.String,
  fps: Schema.optionalKey(Schema.Number),
  pairs: Schema.Array(Schema.Struct({
    id: Schema.Int,
    clients: Schema.String,
    agentSocket: Schema.String,
    runs: Schema.Struct({ a: Schema.optionalKey(Schema.String), b: Schema.optionalKey(Schema.String) }),
    appIds: Schema.Struct({ a: Schema.String, b: Schema.String }),
    profile: Schema.optionalKey(Schema.String),
  })),
}));


export const readPool: Effect.Effect<PoolFile | undefined, LanFailure> = Effect.suspend(() => {
  if (!existsSync(poolFile())) return Effect.succeed(undefined);
  return Effect.try({ try: () => readFileSync(poolFile(), "utf8"), catch: (cause) => new LanFailure({ problem: `${poolFile()}: ${String(cause)}` }) }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(PoolFileJson)),
    Effect.mapError((cause) => (cause instanceof LanFailure ? cause : new LanFailure({ problem: `${poolFile()}: ${cause.message}` }))),
  );
});


export function pairOf(pool: PoolFile, names: readonly string[]): PoolPair | undefined {
  return pool.pairs.find(({ id }) => names.every((name) => PAIR_SIDES.some((side) => clientName(id, side) === name)));
}
