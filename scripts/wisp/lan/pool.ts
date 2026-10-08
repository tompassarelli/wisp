// The offline client pool (wisp:docs/lan.md): Warcraft III clients that never
// sign in, each in its own Wine prefix with a reflinked copy of a Battle.net
// install, run in pairs. Each pair shares one private network namespace whose
// only interface is loopback, one private desktop, and one pair agent
// (pairAgent.ts) that launches the two games and hosts their LAN matches.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const stateRoot = () => join(process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local/state"), "wisp/lan");
export const dataRoot = () => join(process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local/share"), "wisp/lan");

export const PAIR_SIDES = ["a", "b"] as const;
export type Side = (typeof PAIR_SIDES)[number];

/** The pool client of pair `pair`, side a or b: `lan0a`, `lan0b`, `lan1a`, ... */
export const clientName = (pair: number, side: Side) => `lan${pair}${side}`;
/** A client's menu page reports here; distinct for every pool client, as every page's address file is per port. */
export const reportPort = (pair: number, side: Side) => 47200 + pair * 2 + PAIR_SIDES.indexOf(side);
/** Its Wine prefix's compat folder (STEAM_COMPAT_DATA_PATH); the prefix is its pfx/. */
export const clientRoot = (name: string) => join(dataRoot(), "clients", name);
export const prefixOf = (name: string) => join(clientRoot(name), "pfx");
export const installOf = (name: string) => join(prefixOf(name), "drive_c/Program Files (x86)/Warcraft III");
export const retailOf = (name: string) => join(installOf(name), "_retail_");
export const exeOf = (name: string) => join(retailOf(name), "x86_64/Warcraft III.exe");
export const documentsOf = (name: string) => join(prefixOf(name), "drive_c/users/steamuser/Documents/Warcraft III");
export const pairDirectory = (pair: number) => join(stateRoot(), `pair-${pair}`);
/** The client's own silent sink on the user's PipeWire; record it from `<sink>.monitor`. */
export const audioSinkOf = (name: string) => `wisp-lan-${name}`;
/** The pair agent's control socket: a Unix socket, which reaches across network namespaces. */
export const agentSocket = (pair: number) => join(pairDirectory(pair), "agent.sock");

/** Display and cost settings for every client of a pool. */
export interface Profile {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly maxFps: number;
  /** War3Preferences [Video] values besides the window. */
  readonly video: Readonly<Record<string, number>>;
  /** Warcraft 3.0.1 [Misc] hd: Classic=0, Reforged=1, Definitive Edition=2. */
  readonly graphicsMode: "classic" | "reforged" | "definitive";
  /** Sound on; off, the game loads and mixes no sound at all. */
  readonly sound: boolean;
  /** Music too: off for checks that score effects, which music sits under. */
  readonly music: boolean;
}

const LOWEST: Readonly<Record<string, number>> = {
  antialiasing: 0, assao: 0, foliagequality: 0, lightingquality: 0, pointlightshadowquality: 0,
  shadowquality: 0, texquality: 0, waterquality: 0, vsync: 0,
};

/**
 * `parity`: checksum and input runs need no pixels and no sound: the smallest
 * window, every quality setting lowest, classic models, sound off. `checks`:
 * parity with sound, for checks that record a client's audio. `visual`: a
 * window big enough to judge what players see, Reforged models. All run at
 * 60 frames a second, focused or not (wisp:docs/lan.md, "Profiles").
 */
const PARITY: Profile = { name: "parity", width: 800, height: 600, maxFps: 60, video: LOWEST, graphicsMode: "classic", sound: false, music: false };
const VISUAL: Profile = { name: "visual", width: 1280, height: 720, maxFps: 60, video: { ...LOWEST, lightingquality: 2, texquality: 1 }, graphicsMode: "reforged", sound: true, music: true };
export const PROFILES: Readonly<Record<string, Profile>> = {
  parity: PARITY,
  checks: { name: "checks", width: 800, height: 600, maxFps: 60, video: LOWEST, graphicsMode: "classic", sound: true, music: false },
  /** parity at 144 frames a second, focused or not, to compare the game's clocks against a 60 fps cap. */
  hfr: { name: "hfr", width: 800, height: 600, maxFps: 144, video: LOWEST, graphicsMode: "classic", sound: false, music: false },
  visual: VISUAL,
};

/** Hold every graphics choice fixed while measuring a different frame cap. */
export function poolProfile(name: string, fps?: number): Profile {
  const profile = PROFILES[name];
  if (profile === undefined) throw new Error(`unknown pool profile ${name}`);
  if (fps !== undefined && (!Number.isInteger(fps) || fps < 1)) throw new Error("--fps takes a positive whole number");
  return fps === undefined ? profile : { ...profile, maxFps: fps };
}

/** War3Preferences sections a profile sets, by section and key: the game fills in the rest. */
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

/** War3Preferences.txt with the sections a profile sets: the game fills in the rest. */
export function preferences(profile: Profile, windowX: number): string {
  return Object.entries(profileSections(profile, windowX)).map(([name, values]) => `[${name}]\n${Object.keys(values).sort().map((key) => `${key}=${values[key]}`).join("\n")}\n`).join("\n");
}

/**
 * Signed-in clients' graphics, named by a clients file entry's `profile`
 * (wisp:docs/doctor.md, "Graphics profiles"). `minimal`, the default, is the
 * pool's parity settings for functional and gameplay checks; `visual` is for
 * captures where looks matter; `player` is the owner's own Reforged settings
 * (high lighting, everything else lowest, sound on) at 1920x1080, for every
 * performance or frame-pacing measurement.
 */
export const CLIENT_PROFILES = {
  minimal: { ...PARITY, name: "minimal" },
  visual: VISUAL,
  player: { name: "player", width: 1920, height: 1080, maxFps: 60, video: { ...LOWEST, lightingquality: 2 }, graphicsMode: "reforged", sound: true, music: true },
} as const satisfies Readonly<Record<string, Profile>>;
export type ClientProfile = keyof typeof CLIENT_PROFILES;
export const CLIENT_PROFILE_NAMES = Object.keys(CLIENT_PROFILES) as readonly ClientProfile[];

/** A clients file entry's graphics profile: its declared one, minimal when it names none, or the pool's own for an offline client. */
export const profileOf = (client: { readonly profile?: ClientProfile | undefined; readonly offline?: boolean | undefined }) =>
  client.offline === true ? "pool" : client.profile ?? "minimal";

/** The line a session prints so its output records each client's graphics profile. */
export const profilesLine = (clients: readonly { readonly name: string; readonly profile?: ClientProfile | undefined; readonly offline?: boolean | undefined }[]) =>
  `graphics profiles: ${clients.map((client) => `${client.name}=${profileOf(client)}`).join(" ")}`;

/** Why these clients can't take a performance or frame-pacing measurement, which runs only under `player`; undefined when every one runs it. */
export const measurementRefusal = (clients: readonly { readonly name: string; readonly profile?: ClientProfile | undefined; readonly offline?: boolean | undefined }[]) => {
  const others = clients.filter((client) => profileOf(client) !== "player");
  return others.length === 0 ? undefined : `performance and frame-pacing measurements run under the player graphics profile, and ${others.map((client) => `${client.name} runs ${profileOf(client)}`).join(", ")}: set "profile": "player" in the clients file and restart the client`;
};

/** A signed-in client's War3Preferences settings for its profile, as the file spells them, by section. */
export const clientSettings = (profile: ClientProfile): Record<string, Record<string, string>> =>
  Object.fromEntries(Object.entries(profileSections(CLIENT_PROFILES[profile], 0)).map(([section, values]) => [section, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))]));

/** The private desktop one client needs: its window and a margin. */
export const desktopSize = (profile: Profile) => `${profile.width + 40}x${profile.height + 40}`;

/** A pool client as a clients file lists it (the schema `wisp client watch` and the engine tools read). */
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
  /** Each client's private desktop. */
  readonly runs: Readonly<Partial<Record<Side, string>>>;
  readonly appIds: Readonly<Record<Side, string>>;
}

export interface PoolFile {
  readonly profile: string;
  readonly pairs: readonly PoolPair[];
}

export const poolFile = () => join(stateRoot(), "pool.json");
/** Every pool client, for tools that take a clients file. */
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

export function readPool(): PoolFile | undefined {
  return existsSync(poolFile()) ? (JSON.parse(readFileSync(poolFile(), "utf8")) as PoolFile) : undefined;
}

/** The pair whose clients include every one of `names`. */
export function pairOf(pool: PoolFile, names: readonly string[]): PoolPair | undefined {
  return pool.pairs.find(({ id }) => names.every((name) => PAIR_SIDES.some((side) => clientName(id, side) === name)));
}
