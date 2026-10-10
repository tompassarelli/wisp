import { join } from "node:path";
import { Schema } from "effect";

export interface ProcessInfo {

  readonly cpuMs?: number;
  readonly pid: number;

  readonly name: string;
  readonly args: readonly string[];

  readonly prefix?: string;
  readonly display?: string;

  /** The prefix's runtime process (wineserver on Linux), as the process table's layer recognises it. */
  readonly runtime?: boolean;

  readonly cwd?: string;

  readonly started?: number;
}

export interface PrefixUse {

  readonly runtimes: readonly ProcessInfo[];

  readonly processes: readonly ProcessInfo[];

  readonly launcher?: ProcessInfo;

  readonly game?: ProcessInfo;
}

const trimSlash = (path: string) => path.replace(/\/+$/, "");
const commandLine = (process: ProcessInfo) => process.args.join(" ");
const isRuntime = (process: ProcessInfo) => process.runtime === true;
const isLauncher = (process: ProcessInfo) => /\\Battle\.net\\Battle\.net\.exe(?:\s|"|$)/i.test(commandLine(process)) && !/--type=/.test(commandLine(process));
const isGame = (process: ProcessInfo) => /\\Warcraft III\.exe(?:\s|"|$)/i.test(commandLine(process));

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

export const shortcutUrl = (appId: number) => `steam://rungameid/${((BigInt(appId) << 32n) | 0x02000000n).toString()}`;

export const shortcutAppId = (appId: number) => `steam_app_${appId}`;

export const launcherLogDirectory = (prefix: string) => join(prefix, "drive_c/users/steamuser/AppData/Local/Battle.net/Logs");

export const newestLauncherLog = (names: readonly string[]) =>
  names.filter((name) => /^battle\.net-\d{8}T[\d.]+\.log$/.test(name)).sort().at(-1);

export const documentsFolder = (prefix: string) => join(prefix, "drive_c/users/steamuser/Documents/Warcraft III");

export const launcherConfig = (prefix: string) => join(prefix, "drive_c/users/steamuser/AppData/Roaming/Battle.net/Battle.net.config");

export function windowsPath(prefix: string, path: string): string {
  const drive = join(prefix, "drive_c");
  if (!path.startsWith(`${drive}/`)) throw new Error(`${path} is not under ${drive}`);
  return `C:\\${path.slice(drive.length + 1).replaceAll("/", "\\")}`;
}

export const loadMapOption = (prefix: string, map: string) => `-loadfile "${windowsPath(prefix, map)}"`;

const Settings = Schema.Record(Schema.String, Schema.Unknown);
const LauncherSettings = Schema.fromJsonString(Settings);
const Games = Schema.UndefinedOr(Schema.Record(Schema.String, Settings));

function decodeSettings(config: string) {
  const settings = Schema.decodeSync(LauncherSettings)(config);
  return { settings, games: Schema.decodeUnknownSync(Games)(settings.Games) };
}

export function launchOptions(config: string): string | undefined {
  const value = decodeSettings(config).games?.w3?.AdditionalLaunchArguments;
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function withLaunchOptions(config: string, options: string | undefined): string {
  const { settings, games = {} } = decodeSettings(config);
  const w3 = { ...games.w3 };
  if (options === undefined) delete w3.AdditionalLaunchArguments;
  else w3.AdditionalLaunchArguments = options;
  const newline = config.includes("\r\n") ? "\r\n" : "\n";
  return JSON.stringify({ ...settings, Games: { ...games, w3 } }, null, 4).replaceAll("\n", newline);
}

const SIGNED_IN = /\[BNLogin\] .*Logged into Battle\.net successfully/;
export const signedIn = (log: string) => SIGNED_IN.test(log);

export const launchRequested = (log: string) => /\[GameLaunchController\] .*LaunchBinary: uid=w3\b/.test(log);

export type LaunchOutcome = { readonly kind: "running" } | { readonly kind: "failed"; readonly reason: string };

export function launchOutcome(log: string): LaunchOutcome | undefined {
  for (const line of log.split("\n")) {
    if (/\[InstallManager\] .*Game is running: w3\b/.test(line)) return { kind: "running" };
    if (/\[InstallManager\] .*Could not launch .*Warcraft III\.exe/.test(line)) return { kind: "failed", reason: "Battle.net could not start Warcraft III.exe" };
    if (/Pending game launch expired before Agent reported it running\. uid=w3\b/.test(line)) return { kind: "failed", reason: "the launch expired before Warcraft III started" };
  }
  return undefined;
}

export const isErrorDialog = (process: ProcessInfo) => /\\Warcraft III\\_retail_\\x86_64\\BlizzardError\.exe(?:\s|"|$)/i.test(commandLine(process));

export type LauncherHealth =

  | { readonly kind: "signed in" }

  | { readonly kind: "not signed in" }

  | { readonly kind: "sign-in needed"; readonly reason: string }

  | { readonly kind: "sign-in form"; readonly form: LoginForm }

  | { readonly kind: "connection failing"; readonly reason: string };

const LOGIN_REJECTED = /ERROR_TOKEN_NOT_FOUND/;

export type LoginForm = "Login" | "LoginCredential";

export function loginForm(lines: readonly string[]): LoginForm | undefined {
  let form: LoginForm | undefined;
  for (const line of lines) {
    const loaded = /\[UnifiedAuth\] .*UAuth: finished loading\. statusCode=200 state=(Login|LoginCredential)\s*$/.exec(line);
    if (loaded !== null) form = loaded[1] as LoginForm;
    else if (/\[UnifiedAuth\] .*UAuth: (?:status changed: (?:RequestingToken|ReceivedToken)|browser state changed: (?:None|Done))/.test(line)) form = undefined;
  }
  return form;
}
const SSO_FAILED = /GenerateAuth.*(?:fail|error)|SSO token generation error/i;
const RPC_TIMEOUT = /ERROR_RPC_REQUEST_TIMED_OUT/;

const RPC_TIMEOUTS_FAILING = 2;

export function launcherHealth(log: string): LauncherHealth {
  const lines = log.split("\n");
  const last = lines.findLastIndex((line) => SIGNED_IN.test(line));
  const after = lines.slice(last + 1).filter((line) => line.trim() !== "");
  const rejected = after.findLastIndex((line) => LOGIN_REJECTED.test(line));
  if (rejected >= 0 || last < 0) {
    const form = loginForm(after.slice(rejected + 1));
    if (form !== undefined) return { kind: "sign-in form", form };
    return rejected >= 0 ? { kind: "sign-in needed", reason: "Battle.net rejected its saved login (ERROR_TOKEN_NOT_FOUND)" } : { kind: "not signed in" };
  }
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

const SAVED_LOGIN_KEY = "[Software\\\\Blizzard Entertainment\\\\Battle.net\\\\UnifiedAuth]";

export function withoutSavedLogin(userReg: string): string {
  const lines = userReg.split("\n");
  const kept: string[] = [];
  let inKey = false;
  let continued = false;
  for (const line of lines) {
    if (line.startsWith("[")) inKey = line.startsWith(SAVED_LOGIN_KEY);
    const value = inKey && !line.startsWith("[") && !line.startsWith("#") && line.trim() !== "";
    if (!(value || (inKey && continued))) kept.push(line);
    continued = (value || (inKey && continued)) && line.trimEnd().endsWith("\\");
  }
  return kept.join("\n");
}

export const hasSavedLogin = (userReg: string) => withoutSavedLogin(userReg) !== userReg;
