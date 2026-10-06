// What `wisp play` decides by on the host: which Wine runtimes use a prefix,
// where its Battle.net log is, and what that log says about sign-in and a
// launch. Plain functions over a process table and log text, so tests give
// them recorded values.
import { join } from "node:path";

/** One host process, as /proc shows it. */
export interface ProcessInfo {
  readonly pid: number;
  /** The kernel's short name (/proc/PID/comm). */
  readonly name: string;
  readonly args: readonly string[];
  /** Its WINEPREFIX, without a trailing slash. */
  readonly prefix?: string;
  readonly display?: string;
  /** Its working directory; a wineserver's is its prefix's server directory. */
  readonly cwd?: string;
}

/** The processes of one Wine prefix. */
export interface PrefixUse {
  /** Its wineservers. Separate Steam runtime containers can each start one; only one may own the prefix. */
  readonly runtimes: readonly ProcessInfo[];
  /** Every process of the prefix, the wineservers included. */
  readonly processes: readonly ProcessInfo[];
  /** The Battle.net launcher's main process. */
  readonly launcher?: ProcessInfo;
  /** Warcraft III's game process. */
  readonly game?: ProcessInfo;
}

const trimSlash = (path: string) => path.replace(/\/+$/, "");
const commandLine = (process: ProcessInfo) => process.args.join(" ");
const isRuntime = (process: ProcessInfo) => process.name === "wineserver" || /\/wineserver$/.test(process.args[0] ?? "");
const isLauncher = (process: ProcessInfo) => /\\Battle\.net\\Battle\.net\.exe(?:\s|"|$)/i.test(commandLine(process)) && !/--type=/.test(commandLine(process));
const isGame = (process: ProcessInfo) => /\\Warcraft III\.exe(?:\s|"|$)/i.test(commandLine(process));

/**
 * Wine names a prefix's server directory after the prefix directory's device
 * and inode; a wineserver started from another mount namespace keeps that
 * name, so it identifies the prefix when the environment doesn't.
 */
export const serverDirectoryName = (device: bigint, inode: bigint) => `server-${device.toString(16)}-${inode.toString(16)}`;

export function prefixUse(processes: readonly ProcessInfo[], prefix: string, serverDirectory: string): PrefixUse {
  const wanted = trimSlash(prefix);
  const inPrefix = processes.filter((process) =>
    (process.prefix !== undefined && trimSlash(process.prefix) === wanted)
    || (isRuntime(process) && process.cwd !== undefined && process.cwd.split("/").at(-1) === serverDirectory));
  const launcher = inPrefix.find(isLauncher);
  const game = inPrefix.find(isGame);
  return { runtimes: inPrefix.filter(isRuntime), processes: inPrefix, ...(launcher === undefined ? {} : { launcher }), ...(game === undefined ? {} : { game }) };
}

/** The Steam URL that starts a non-Steam shortcut: its 32-bit app id above the shortcut flag 0x02000000. */
export const shortcutUrl = (appId: number) => `steam://rungameid/${((BigInt(appId) << 32n) | 0x02000000n).toString()}`;

/** The window class Steam gives a shortcut's windows. */
export const shortcutAppId = (appId: number) => `steam_app_${appId}`;

/** Where the launcher writes one log per start, named by its start time. */
export const launcherLogDirectory = (prefix: string) => join(prefix, "drive_c/users/steamuser/AppData/Local/Battle.net/Logs");

/** The newest launcher log among a directory's file names; their timestamps sort as text. */
export const newestLauncherLog = (names: readonly string[]) =>
  names.filter((name) => /^battle\.net-\d{8}T[\d.]+\.log$/.test(name)).sort().at(-1);

export const documentsFolder = (prefix: string) => join(prefix, "drive_c/users/steamuser/Documents/Warcraft III");

/** The launcher's settings, Warcraft III's launch options among them; it writes them back when it exits. */
export const launcherConfig = (prefix: string) => join(prefix, "drive_c/users/steamuser/AppData/Roaming/Battle.net/Battle.net.config");

/** A file under the prefix's drive_c, as Windows programs in the prefix name it. */
export function windowsPath(prefix: string, path: string): string {
  const drive = join(prefix, "drive_c");
  if (!path.startsWith(`${drive}/`)) throw new Error(`${path} is not under ${drive}`);
  return `C:\\${path.slice(drive.length + 1).replaceAll("/", "\\")}`;
}

/**
 * Warcraft III's launch option that loads a map straight into a game, as the
 * World Editor's Test Map does; Play passes the launch options after its own.
 */
export const loadMapOption = (prefix: string, map: string) => `-loadfile "${windowsPath(prefix, map)}"`;

/** Battle.net's "Additional command line arguments" for Warcraft III: Games.w3.AdditionalLaunchArguments. */
export function launchOptions(config: string): string | undefined {
  const parsed: unknown = JSON.parse(config);
  const games = typeof parsed === "object" && parsed !== null ? (parsed as { Games?: { w3?: { AdditionalLaunchArguments?: unknown } } }).Games : undefined;
  const value = games?.w3?.AdditionalLaunchArguments;
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The settings with Warcraft III's launch options set, or removed when undefined, in the launcher's own layout. */
export function withLaunchOptions(config: string, options: string | undefined): string {
  const parsed = JSON.parse(config) as { Games?: Record<string, Record<string, unknown>> };
  const games = (parsed.Games ??= {});
  const w3 = (games.w3 ??= {});
  if (options === undefined) delete w3.AdditionalLaunchArguments;
  else w3.AdditionalLaunchArguments = options;
  const newline = config.includes("\r\n") ? "\r\n" : "\n";
  return JSON.stringify(parsed, null, 4).replaceAll("\n", newline);
}

const SIGNED_IN = /\[BNLogin\] .*Logged into Battle\.net successfully/;
export const signedIn = (log: string) => SIGNED_IN.test(log);

/** The launcher took a Play of Warcraft III: it asks its agent to launch the game. */
export const launchRequested = (log: string) => /\[GameLaunchController\] .*LaunchBinary: uid=w3\b/.test(log);

export type LaunchOutcome = { readonly kind: "running" } | { readonly kind: "failed"; readonly reason: string };

/**
 * What the launcher logged about Warcraft III's launch in `log`, the text it
 * wrote after Play. A launcher whose runtime started beside another runtime on
 * the same prefix logs "Could not launch"; an expired pending launch follows.
 */
export function launchOutcome(log: string): LaunchOutcome | undefined {
  for (const line of log.split("\n")) {
    if (/\[InstallManager\] .*Game is running: w3\b/.test(line)) return { kind: "running" };
    if (/\[InstallManager\] .*Could not launch .*Warcraft III\.exe/.test(line)) return { kind: "failed", reason: "Battle.net could not start Warcraft III.exe" };
    if (/Pending game launch expired before Agent reported it running\. uid=w3\b/.test(line)) return { kind: "failed", reason: "the launch expired before Warcraft III started" };
  }
  return undefined;
}

/**
 * Warcraft III's crash reporter, which holds the error dialog up after a
 * crash: _retail_\x86_64\BlizzardError.exe (the launcher's own copies live
 * under Battle.net\, and are another program's).
 */
export const isErrorDialog = (process: ProcessInfo) => /\\Warcraft III\\_retail_\\x86_64\\BlizzardError\.exe(?:\s|"|$)/i.test(commandLine(process));

export type LauncherHealth =
  /** Signed in, with nothing failing since. */
  | { readonly kind: "signed in" }
  /** No sign-in in this launcher's log yet: it is starting, or showing its sign-in form. */
  | { readonly kind: "not signed in" }
  /** Battle.net rejected the saved login: only the account owner can sign in again. */
  | { readonly kind: "sign-in needed"; readonly reason: string }
  /** Signed in, but its connection to Battle.net fails: a restarted launcher reconnects. */
  | { readonly kind: "connection failing"; readonly reason: string };

const LOGIN_REJECTED = /ERROR_TOKEN_NOT_FOUND/;
const SSO_FAILED = /GenerateAuth.*(?:fail|error)|SSO token generation error/i;
const RPC_TIMEOUT = /ERROR_RPC_REQUEST_TIMED_OUT/;
/** Presence updates fail every 46 s while the connection is gone (3 Oct, client B); two in a row, with nothing logged in between that worked, is not a blip. */
const RPC_TIMEOUTS_FAILING = 2;

/**
 * What a launcher's log (its newest battle.net-*.log) says about its sign-in
 * and its connection (smashcraft:docs/warcraft-authentication.md). After its
 * last sign-in: a rejected saved login needs the owner; a failed Warcraft III
 * sign-in token, or presence updates timing out to the log's end, is a
 * connection the launcher lost, which a restart of the launcher reconnects.
 */
export function launcherHealth(log: string): LauncherHealth {
  const lines = log.split("\n");
  const last = lines.findLastIndex((line) => SIGNED_IN.test(line));
  const after = lines.slice(last + 1).filter((line) => line.trim() !== "");
  const rejected = after.find((line) => LOGIN_REJECTED.test(line));
  if (rejected !== undefined) return { kind: "sign-in needed", reason: "Battle.net rejected its saved login (ERROR_TOKEN_NOT_FOUND)" };
  if (last < 0) return { kind: "not signed in" };
  if (after.some((line) => SSO_FAILED.test(line))) return { kind: "connection failing", reason: "Warcraft III's sign-in token couldn't be made (GenerateAuth failed)" };
  let timeouts = 0;
  for (const line of after.toReversed()) {
    if (!/^[EW] /.test(line)) continue;
    if (!RPC_TIMEOUT.test(line)) break;
    if (/\[BNPresence\]/.test(line)) timeouts++;
  }
  return timeouts >= RPC_TIMEOUTS_FAILING
    ? { kind: "connection failing", reason: `its last ${timeouts} presence updates timed out (ERROR_RPC_REQUEST_TIMED_OUT)` }
    : { kind: "signed in" };
}
