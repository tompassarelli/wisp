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
}

const LOWEST: Readonly<Record<string, number>> = {
  antialiasing: 0, assao: 0, bloom: 0, foliagequality: 0, lightingquality: 0, particles: 0, pointlightshadowquality: 0,
  portraitBloom: 0, shadowquality: 0, spellfilter: 0, texquality: 0, waterquality: 0, vsync: 0,
};

/**
 * `parity`: checksum and input runs need no pixels, so the smallest window and
 * the lowest settings. `visual`: a window big enough to judge what players see.
 * Both run at 60 frames a second, focused or not, so the game loop keeps the
 * cadence the map's 60 Hz callbacks expect.
 */
export const PROFILES: Readonly<Record<string, Profile>> = {
  parity: { name: "parity", width: 800, height: 600, maxFps: 60, video: LOWEST },
  visual: { name: "visual", width: 1280, height: 720, maxFps: 60, video: { ...LOWEST, lightingquality: 2, particles: 2, texquality: 1 } },
};

/** War3Preferences.txt with only its [Video] section: the game fills in the rest. */
export function preferences(profile: Profile, windowX: number): string {
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
  return `[Video]\n${Object.keys(video).sort().map((key) => `${key}=${video[key]}`).join("\n")}\n`;
}

/** The private desktop one client needs: its window and a margin. */
export const desktopSize = (profile: Profile) => `${profile.width + 40}x${profile.height + 40}`;

/** A pool client as a clients file lists it (the schema `wisp watch` and the engine tools read). */
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
