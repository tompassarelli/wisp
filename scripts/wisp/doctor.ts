// `doctor`: finds Warcraft III clients in a known bad state and runs that
// state's recovery, one printed line per step (wisp:docs/doctor.md). It reads
// what each client is doing from `watch` (wisp:scripts/wisp/watch.ts) and the
// client's Wine prefix: its processes and its Battle.net launcher's log.
//
// Recoveries never start Warcraft III.exe themselves (only the launcher does,
// asked through its own --exec) and never start a runtime beside another on a
// prefix. A launcher at its sign-in form is signed in with the client's
// declared account; without one, doctor stops with one plain line. A state
// doctor has no recovery for is reported, not guessed at.
import { join } from "node:path";
import { Clock, Context, Effect, Schema } from "effect";
import {
  type LauncherHealth, type PrefixUse, type ProcessInfo, hasSavedLogin, isErrorDialog, launchOutcome, launchRequested, launcherHealth, launcherLogDirectory, newestLauncherLog,
  prefixUse, shortcutUrl, withoutSavedLogin,
} from "../warcraft/battleNet";
import { type DisplayChange, type PreferenceSettings, preferenceChanges, preferencesPath, withPreferences } from "../warcraft/preferences";
import { sessionLines, war3LogPath } from "../warcraft/war3Log";
import type { Client } from "./clients";
import { clientUnit } from "./clientServices";
import { pollFor } from "./hostProcess";
import { PlayMachine, type PlayProblem } from "./play";
import { type ClientView, ClientWatch, type StateKind, waitFor } from "./watch";

/** One client doctor looks after. */
export interface DoctorTarget {
  readonly client: Client;
  /** The Wine prefix (the pfx folder) its Battle.net and Warcraft III run in. */
  readonly prefix: string;
  /** Where its windows are, for the sign-in line, as in "display :1". */
  readonly display?: string;
  /**
   * How its Battle.net Launcher.exe starts in the prefix: a Steam shortcut (its
   * app id and name), or a command that starts it on the client's own display,
   * as a private desktop's clients are started; its output goes to `log`.
   * Offline clients belong to the LAN pool, which owns their lifecycle.
   */
  readonly start:
    | { readonly kind: "steam"; readonly appId: number; readonly name: string }
    | { readonly kind: "command"; readonly command: readonly string[]; readonly log?: string }
    /** Offline clients are started and recovered by their LAN pool owner. */
    | { readonly kind: "offline-pool" };
  /**
   * The War3Preferences.txt settings this client needs, by section: its
   * graphics profile's [Video], [Misc] and [Sound] (windowmode, reswidth, hd,
   * sfx, ...) with the clients file's own display settings over them. Doctor
   * writes them back while Warcraft III is closed: a run on another display
   * rewrites them on exit, and settings apply only at launch.
   */
  readonly settings?: PreferenceSettings;
  /**
   * The Battle.net account doctor signs in with when the launcher shows its
   * sign-in form: commands that print the account's username and password on
   * stdout. They run only while doctor types that field; the value goes to the
   * form through a pipe and is never printed. Without it, the form stops doctor.
   */
  readonly account?: { readonly username: readonly string[]; readonly password: readonly string[] };
}

/** Why doctor stopped, as one plain line per client. */
export class DoctorStop extends Schema.TaggedError<DoctorStop>()("DoctorStop", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

/**
 * What doctor does inside a client. With `launches`, doctor asks the client's
 * signed-in launcher to start Warcraft III; a caller that launches it itself (`play`) leaves
 * it out, and doctor then leaves a client closed or at its signed-in launcher.
 */
export class DoctorHands extends Context.Service<DoctorHands, {
  readonly launches: boolean;
  /** Leaves the lobby the client is in, for the menus it came from. */
  readonly leaveLobby: (target: DoctorTarget) => Effect.Effect<void, PlayProblem>;
  /** Leaves the score screen with a key; doctor calls it only while the client's watch shows the score screen. */
  readonly closeScore: (target: DoctorTarget) => Effect.Effect<void, PlayProblem>;
  /** Types the target's account field into the launcher's sign-in form and submits it; absent, doctor never signs in. */
  readonly enterLogin?: (target: DoctorTarget, field: "username" | "password") => Effect.Effect<void, PlayProblem>;
}>()("wisp/DoctorHands") {}

/** Seconds each bound allows. */
export const DOCTOR_TIMEOUTS = {
  /** A runtime outlives its last program by a few seconds; ended programs get this long before SIGKILL. */
  exit: 20,
  launcherStart: 90,
  signIn: 90,
  /** A submitted sign-in page: the password page loaded 1 s after the account name, and the sign-in landed 5 s after the password (client A, 6 Oct). */
  signInPage: 30,
  /** A launcher that signs in itself waits this long for its sign-in form: on 7 Oct client B's password page took 47 s to load, 92 s after the launcher started. */
  signInForm: 240,
  /** From the launch request to the launcher's log taking it. */
  request: 15,
  launch: 45,
  gameProcess: 60,
  /** Warcraft III signed in 14 s after starting on 6 Oct; past this with no sign-in it shows the empty Options/Exit Game shell. */
  loginShell: 120,
  /** A map that loads longer than this is stuck (a 6 Oct load crashed instead). */
  loading: 120,
} as const;

/** What doctor saw of a client. */
export interface Observation {
  readonly use: PrefixUse;
  /** Warcraft III's crash reporter, holding its error dialog up. */
  readonly errorDialog?: ProcessInfo;
  /** What the newest launcher log says, while a launcher runs. */
  readonly launcher?: LauncherHealth;
  /** The watch's view, while Warcraft III runs. */
  readonly view?: ClientView;
  /** Why the watch couldn't say, while Warcraft III runs. */
  readonly unknown?: string;
  /** The declared display settings Warcraft III's preferences file doesn't hold. */
  readonly displayChanges?: readonly DisplayChange[];
  /** Milliseconds this observation's state has held. */
  readonly held: number;
  /** CPU percent while the current game's log stayed unchanged for at least 60 seconds. */
  readonly startupCpu?: number;
}

/** A known bad state, or a step toward a running client, each with its recovery. */
export type Problem =
  | "two runtimes"
  | "runtime without Battle.net"
  | "connection failing"
  | "launch failed"
  | "crashed"
  | "disconnected"
  | "empty login shell"
  | "map without its imports"
  | "stuck loading"
  | "hung startup"
  | "display settings changed"
  | "stale lobby"
  | "score screen"
  | "closed"
  | "sign-in form"
  | "no game";

export type Diagnosis =
  | { readonly kind: "ready"; readonly detail: string }
  /** A state on its way somewhere: starting, signing in, loading. */
  | { readonly kind: "wait"; readonly detail: string }
  | { readonly kind: "problem"; readonly problem: Problem; readonly detail: string }
  /** Only a person can go on: a sign-in, or a state doctor doesn't know. */
  | { readonly kind: "stop"; readonly problem: string };

/** The recovery each problem runs, as its status line names it. */
export const RECOVERY: Readonly<Record<Problem, string>> = {
  "two runtimes": "ending every program of the prefix",
  "runtime without Battle.net": "ending every program of the prefix",
  "connection failing": "restarting Battle.net",
  "launch failed": "restarting Battle.net",
  crashed: "closing the error dialog and Warcraft III",
  disconnected: "ending Warcraft III",
  "empty login shell": "ending Warcraft III",
  "map without its imports": "ending Warcraft III",
  "stuck loading": "ending Warcraft III",
  "hung startup": "ending Warcraft III and relaunching once",
  "display settings changed": "restoring the display settings",
  "stale lobby": "leaving the lobby",
  "score screen": "leaving the score screen",
  closed: "starting Battle.net",
  "sign-in form": "signing in with its account",
  "no game": "asking Battle.net to launch Warcraft III",
};

const pids = (processes: readonly ProcessInfo[]) => processes.map(({ pid }) => pid).join(" ");
const LOGIN_SCREENS = new Set(["LOGIN_DOORS", "LOGIN_OPTIONS"]);

const describeView = (view: ClientView) => {
  const { state } = view;
  return "screen" in state ? `${state.kind} (${state.screen})` : state.kind;
};

/**
 * The state of a client, as doctor names it: what to do next. Ordered so the
 * prefix comes first (two runtimes break every launch), then the game, then
 * the launcher. `canPlay`: doctor launches the game itself; `started`: this run did.
 */
export function diagnose(seen: Observation, canPlay: boolean, display?: string, started = false, signsIn = false): Diagnosis {
  const { use, view, held } = seen;
  const problem = (name: Problem, detail: string): Diagnosis => ({ kind: "problem", problem: name, detail });
  const where = display === undefined ? "its launcher" : `its launcher on display ${display}`;
  const signIn = `needs its owner to sign in to Battle.net: sign in in ${where} with "Keep me logged in" ticked, then run doctor again`;
  if (use.runtimes.length > 1) {
    return problem("two runtimes", `${use.runtimes.length} Wine runtimes use the prefix (wineserver pids ${pids(use.runtimes)}); a launcher beside another runtime can't start the game`);
  }
  if (seen.errorDialog !== undefined) return problem("crashed", `Warcraft III's error dialog is up (BlizzardError.exe pid ${seen.errorDialog.pid})`);
  if (use.game !== undefined) {
    if (view === undefined) return { kind: "stop", problem: `Warcraft III runs (pid ${use.game.pid}), but its state is unknown: ${seen.unknown ?? "watch reported nothing"}` };
    const { state } = view;
    const by = `${view.source}: ${view.evidence}`;
    if (state.kind === "crashed") return problem("crashed", `${state.reason} (${by})`);
    if (state.kind === "disconnected") return problem("disconnected", `${state.reason} (${by})`);
    if (view.loadErrors.count > 0) {
      return problem("map without its imports", `Warcraft III couldn't create ${view.loadErrors.count} of the map's imported models (first "model creation failed - ${view.loadErrors.first}"), so they won't draw`);
    }
    const seconds = Math.round(held / 1000);
    switch (state.kind) {
      case "signing in":
        if (held < DOCTOR_TIMEOUTS.loginShell * 1000) return { kind: "wait", detail: "Warcraft III signing in" };
        // War3Log.txt is written in bursts: on 6 Oct client B's stopped 3 s into a session that signed in and played all evening.
        if (view.source !== "socket") return { kind: "ready", detail: `signing in by its log only (${by}); its menus don't report, so doctor leaves it` };
        return problem("empty login shell", `Warcraft III hasn't signed in ${seconds} s after starting: its login closed to the empty Options/Exit Game shell`);
      case "menus":
        if (LOGIN_SCREENS.has(state.screen)) {
          return held >= DOCTOR_TIMEOUTS.loginShell * 1000
            ? problem("empty login shell", `Warcraft III has shown ${state.screen} for ${seconds} s: the empty Options/Exit Game shell`)
            : { kind: "wait", detail: `Warcraft III at ${state.screen}` };
        }
        return { kind: "ready", detail: describeView(view) };
      case "loading":
        return held >= DOCTOR_TIMEOUTS.loading * 1000
          ? problem("stuck loading", `Warcraft III has been loading${state.map === undefined ? "" : ` ${state.map}`} for ${seconds} s`)
          : { kind: "wait", detail: "Warcraft III loading a map" };
      case "lobby":
        return problem("stale lobby", `Warcraft III is in a lobby${state.map === undefined ? "" : ` of ${state.map}`}${state.host === true ? " it hosts" : ""} from an earlier run`);
      case "results":
        return problem("score screen", "Warcraft III shows an earlier match's score screen");
      case "signed in":
      case "in match":
        return { kind: "ready", detail: describeView(view) };
      case "running":
        if (seen.startupCpu !== undefined && seen.startupCpu < 1) return problem("hung startup", `Warcraft III used ${seen.startupCpu.toFixed(2)}% CPU and added no War3Log line for 60 s`);
        // A game this run started says where it is within its sign-in; one found running is left as it is.
        if ((started || use.game.cpuMs !== undefined) && held < DOCTOR_TIMEOUTS.loginShell * 1000) return { kind: "wait", detail: "Warcraft III starting" };
        return { kind: "ready", detail: `${describeView(view)}; no source says where it is, so doctor leaves it` };
      case "closed":
      case "launcher":
        return { kind: "wait", detail: "Warcraft III starting" };
    }
  }
  if (seen.displayChanges !== undefined && seen.displayChanges.length > 0) {
    const list = seen.displayChanges.map(({ key, expected, actual }) => `${key} is ${actual ?? "missing"}, expected ${expected}`).join(", ");
    return problem("display settings changed", `War3Preferences.txt no longer holds this client's display settings (${list}); a run on another display rewrites them when Warcraft III exits`);
  }
  if (use.launcher === undefined) {
    const [runtime] = use.runtimes;
    if (runtime !== undefined) {
      return held >= DOCTOR_TIMEOUTS.exit * 1000
        ? problem("runtime without Battle.net", `a Wine runtime (wineserver pid ${runtime.pid}) uses the prefix without Battle.net`)
        : { kind: "wait", detail: "a Wine runtime without Battle.net exiting" };
    }
    return canPlay ? problem("closed", "neither Battle.net nor Warcraft III runs") : { kind: "ready", detail: "closed" };
  }
  const health = seen.launcher ?? { kind: "not signed in" };
  switch (health.kind) {
    case "sign-in form":
      return signsIn ? problem("sign-in form", `Battle.net shows its ${health.form === "Login" ? "account" : "password"} page`) : { kind: "stop", problem: `Battle.net shows its sign-in form; it ${signIn}` };
    case "sign-in needed":
      // The launcher opens its sign-in form after a rejected saved login (3 Oct).
      if (signsIn && held < DOCTOR_TIMEOUTS.signInForm * 1000) return { kind: "wait", detail: `${health.reason}; Battle.net opening its sign-in form` };
      return { kind: "stop", problem: `${health.reason}; it ${signIn}` };
    case "not signed in":
      return held >= (signsIn ? DOCTOR_TIMEOUTS.signInForm : DOCTOR_TIMEOUTS.signIn) * 1000 ? { kind: "stop", problem: `Battle.net hasn't signed in after ${Math.round(held / 1000)} s; it ${signIn}` } : { kind: "wait", detail: "Battle.net signing in" };
    case "connection failing":
      return problem("connection failing", `Battle.net is signed in, but ${health.reason}`);
    case "signed in":
      return canPlay ? problem("no game", "Battle.net is signed in; Warcraft III isn't running") : { kind: "ready", detail: "Battle.net signed in" };
  }
}

/** How a client ended up. */
export interface DoctorResult {
  readonly client: string;
  /** Its state once ready. */
  readonly state: string;
  /** The problems doctor recovered, in order. */
  readonly recovered: readonly Problem[];
}

const POLL = "1 second";
/** A lobby or score screen left through the menus changes screen within this (the menus answer a leave in under 10 s). */
const LEAVE_SECONDS = 10;
/**
 * Escape presses on a score screen before doctor ends Warcraft III and has it
 * launched again: on 7 Oct client B (3.0.0.24268) stayed on the score screen
 * after one Escape in three doctor runs, and left it on a later press.
 */
export const SCORE_ESCAPES = 3;

/** A process's start time is read to the second (/proc/stat's boot time), so a log may look up to that much older than its launcher. */
const LOG_START_SLACK_MS = 1000;

/** Brings one client to a ready state, printing each step as "NAME: ...". */
export const doctorClient = (target: DoctorTarget, print: (line: string) => void) => {
  /** The start lock's release, once this run starts Battle.net or the game: held until the run ends (its menus, or a stop). */
  let releaseStart: Effect.Effect<void> | undefined;
  return doctorRun(target, print, (taken) => {
    releaseStart = taken;
  }).pipe(Effect.ensuring(Effect.suspend(() => releaseStart ?? Effect.void)));
};

const doctorRun = (target: DoctorTarget, print: (line: string) => void, holdStart: (release: Effect.Effect<void>) => void) => Effect.gen(function*() {
  const { start } = target;
  if (start.kind === "offline-pool") {
    const view = yield* ClientWatch.use((watch) => watch.view(target.client)).pipe(Effect.mapError((cause) => new DoctorStop({ problem: cause.message })));
    if (["closed", "crashed", "disconnected"].includes(view.state.kind)) return yield* new DoctorStop({ problem: `${target.client.name}: ${view.state.kind}; restart its offline pool pair before retrying` });
    yield* Effect.sync(() => print(`${target.client.name}: ready: ${view.state.kind}`));
    return { client: target.client.name, state: view.state.kind, recovered: [] } satisfies DoctorResult;
  }
  const machine = yield* PlayMachine;
  const watch = yield* ClientWatch;
  const hands = yield* DoctorHands;
  const { client, prefix } = target;
  const name = client.name;
  const say = (text: string) => Effect.sync(() => print(`${name}: ${text}`));
  const stop = (problem: string) => Effect.fail(new DoctorStop({ problem: `${name}: ${problem}` }));
  const failed = (cause: PlayProblem) => new DoctorStop({ problem: `${name}: ${cause.problem}` });
  /** Clients start one at a time on the machine: this run takes the start lock before it starts Battle.net or the game. */
  let lockHeld = false;
  const takeStartLock = Effect.gen(function*() {
    if (lockHeld) return;
    holdStart(yield* machine.startLock(name, (line) => print(`${name}: ${line}`)).pipe(Effect.mapError(failed)));
    lockHeld = true;
  });
  const logs = launcherLogDirectory(prefix);
  const war3Log = war3LogPath(client.documents);
  const preferences = preferencesPath(client.documents);
  const server = yield* machine.serverDirectory(prefix).pipe(Effect.mapError(failed));

  const prefixState = machine.processes.pipe(Effect.map((processes) => prefixUse(processes, prefix, server)), Effect.mapError(failed));
  const newestLog = machine.list(logs).pipe(Effect.map(newestLauncherLog), Effect.mapError(failed));
  let priorSessionLog: string | undefined;
  /**
   * The running launcher's log: the newest with a sign-in line, else the newest.
   * A prefix copied from another install carries that install's logs, so only
   * logs written since the launcher started count.
   */
  const loginLog = (launcher: ProcessInfo | undefined) => Effect.gen(function*() {
    const names = (yield* machine.list(logs)).filter((name) => newestLauncherLog([name]) !== undefined && (priorSessionLog === undefined || name > priorSessionLog)).sort().reverse();
    const since = launcher?.started;
    const current: string[] = [];
    for (const name of names) {
      const written = since === undefined ? undefined : yield* machine.modified(join(logs, name));
      if (since === undefined || (written !== undefined && written >= since - LOG_START_SLACK_MS)) current.push(name);
    }
    for (const name of current) {
      if (/\[BNLogin\]/.test((yield* machine.read(join(logs, name))) ?? "")) return name;
    }
    return current[0];
  }).pipe(Effect.mapError(failed));

  /** The newest session's span in Warcraft III's own log: a lower bound on how long it has run. */
  const sessionSpan = machine.read(war3Log).pipe(Effect.map((text) => {
    const lines = sessionLines(text ?? "");
    const first = lines[0];
    const last = lines.at(-1);
    return first === undefined || last === undefined ? 0 : last.at - first.at;
  }), Effect.mapError(failed));

  let since: { readonly key: string; readonly at: number } | undefined;
  let startup: { readonly pid: number; readonly log: string; readonly at: number; readonly cpu: number } | undefined;
  const observe = Effect.gen(function*() {
    const use = yield* prefixState;
    const errorDialog = use.processes.find(isErrorDialog);
    const log = use.launcher === undefined ? undefined : yield* loginLog(use.launcher);
    const launcher = log === undefined ? undefined : launcherHealth((yield* machine.read(join(logs, log)).pipe(Effect.mapError(failed))) ?? "");
    // Warcraft III rewrites the file when it exits, so only a closed game's file is settled.
    let changes: readonly DisplayChange[] | undefined;
    if (target.settings !== undefined && use.game === undefined && errorDialog === undefined) {
      const text = yield* machine.read(preferences).pipe(Effect.mapError(failed));
      if (text !== undefined) changes = preferenceChanges(text, target.settings);
    }
    let view: ClientView | undefined;
    let unknown: string | undefined;
    if (use.game !== undefined) {
      const watched = yield* watch.view(client).pipe(Effect.result);
      if (watched._tag === "Success") view = watched.success;
      else unknown = watched.failure.message;
    }
    const key = [changes === undefined || changes.length === 0 ? "-" : "display", use.runtimes.length, use.launcher === undefined ? "-" : launcher?.kind, use.game === undefined ? "-" : view === undefined ? "?" : describeView(view)].join("|");
    const now = yield* Clock.currentTimeMillis;
    let startupCpu: number | undefined;
    if (use.game !== undefined && view?.state.kind === "running" && use.game.cpuMs !== undefined) {
      const text = (yield* machine.read(war3Log).pipe(Effect.mapError(failed))) ?? "";
      if (startup === undefined || startup.pid !== use.game.pid || startup.log !== text) startup = { pid: use.game.pid, log: text, at: now, cpu: use.game.cpuMs };
      if (now - startup.at >= 60_000) startupCpu = (use.game.cpuMs - startup.cpu) * 100 / (now - startup.at);
    } else startup = undefined;
    if (since === undefined || since.key !== key) since = { key, at: now };
    let held = now - since.at;
    if (view?.state.kind === "signing in") held = Math.max(held, yield* sessionSpan);
    return { use, ...(startupCpu === undefined ? {} : { startupCpu }), ...(errorDialog === undefined ? {} : { errorDialog }), ...(launcher === undefined ? {} : { launcher }), ...(view === undefined ? {} : { view }), ...(unknown === undefined ? {} : { unknown }), ...(changes === undefined ? {} : { displayChanges: changes }), held } satisfies Observation;
  });

  const poll = <A>(seconds: number, check: Effect.Effect<A | undefined, DoctorStop>) => pollFor(seconds, POLL, check);

  /** Ends `pick`'s processes: SIGTERM, then SIGKILL after DOCTOR_TIMEOUTS.exit; stops doctor when they outlive that. */
  const end = (what: string, pick: (use: PrefixUse) => readonly ProcessInfo[]) => Effect.gen(function*() {
    const targets = pick(yield* prefixState);
    if (targets.length === 0) return;
    yield* say(`ending ${what} (pids ${pids(targets)})`);
    yield* machine.signal(targets.map(({ pid }) => pid), "SIGTERM");
    const gone = prefixState.pipe(Effect.map((use) => (pick(use).length === 0 ? true : undefined)));
    if ((yield* poll(DOCTOR_TIMEOUTS.exit, gone)) === true) return;
    const left = pick(yield* prefixState);
    yield* say(`${pids(left)} didn't exit within ${DOCTOR_TIMEOUTS.exit} s; killing`);
    yield* machine.signal(left.map(({ pid }) => pid), "SIGKILL");
    if ((yield* poll(DOCTOR_TIMEOUTS.exit, gone)) === undefined) return yield* stop(`can't end ${what}: kill -9 ${pids(pick(yield* prefixState))}`);
  });

  /** Every program of the prefix; then Steam must see its shortcut end, so it can start it again. */
  const endPrefix = Effect.gen(function*() {
    yield* end("every program of the prefix", (use) => use.processes);
    if (start.kind !== "steam") return;
    const launch = `AppId=${start.appId}`;
    const steamDone = machine.processes.pipe(Effect.mapError(failed), Effect.map((processes) => (processes.some((process) => process.args.includes("SteamLaunch") && process.args.includes(launch)) ? undefined : true)));
    if ((yield* poll(DOCTOR_TIMEOUTS.exit, steamDone)) === undefined) return yield* stop(`Steam still runs the shortcut "${start.name}" after its programs exited`);
  });

  const endGame = end("Warcraft III", (use) => [...(use.game === undefined ? [] : [use.game]), ...use.processes.filter(isErrorDialog)]);

  const startLauncher = Effect.gen(function*() {
    const before = yield* newestLog;
    priorSessionLog = before;
    yield* takeStartLock;
    const how = start.kind === "steam" ? `the Steam shortcut "${start.name}" (steam ${shortcutUrl(start.appId)})` : `its launch command (${start.command.join(" ")})`;
    yield* say(`starting Battle.net with ${start.kind === "steam" ? `the Steam shortcut "${start.name}"` : "its launch command"}`);
    if (start.kind === "steam") yield* machine.openSteam(shortcutUrl(start.appId)).pipe(Effect.mapError(failed));
    else {
      yield* machine.startService(clientUnit(name), start.command, start.log).pipe(Effect.mapError(failed));
      yield* say(`launch command running as the service ${clientUnit(name)}`);
    }
    const launched = yield* poll(DOCTOR_TIMEOUTS.launcherStart, Effect.gen(function*() {
      const use = yield* prefixState;
      if (use.runtimes.length > 1) return yield* stop(`starting Battle.net left ${use.runtimes.length} Wine runtimes on the prefix (wineserver pids ${pids(use.runtimes)})`);
      const log = yield* newestLog;
      return use.launcher !== undefined && log !== undefined && log !== before ? true : undefined;
    }));
    if (launched === undefined) return yield* stop(`Battle.net didn't start within ${DOCTOR_TIMEOUTS.launcherStart} s from ${how}`);
    yield* say("Battle.net started");
  });

  /** The launcher's launch of Warcraft III, confirmed by its log; the game's process must follow. Returns false when the launcher reported a failed launch. */
  const launchGame = Effect.gen(function*() {
    const { launcher } = yield* prefixState;
    if (launcher === undefined) return yield* stop("Battle.net isn't running in the prefix");
    const log = yield* loginLog(launcher);
    if (log === undefined) return yield* stop(`Battle.net has no log in ${logs}`);
    const path = join(logs, log);
    const offset = (yield* machine.size(path).pipe(Effect.mapError(failed))) ?? 0;
    yield* takeStartLock;
    yield* machine.launch(launcher).pipe(Effect.mapError(failed));
    const written = machine.read(path, offset).pipe(Effect.map((text) => text ?? ""), Effect.mapError(failed));
    const taken = yield* poll(DOCTOR_TIMEOUTS.request, written.pipe(Effect.map((text) => (launchRequested(text) || launchOutcome(text) !== undefined ? true : undefined))));
    if (taken === undefined) return yield* stop(`Battle.net didn't launch Warcraft III within ${DOCTOR_TIMEOUTS.request} s of being asked (its log: ${path}); check that it is signed in to an account that owns the game`);
    const outcome = (yield* poll(DOCTOR_TIMEOUTS.launch, written.pipe(Effect.map(launchOutcome)))) ?? { kind: "failed", reason: `Battle.net reported no launch within ${DOCTOR_TIMEOUTS.launch} s` };
    if (outcome.kind === "failed") {
      yield* say(outcome.reason);
      return false;
    }
    const game = yield* poll(DOCTOR_TIMEOUTS.gameProcess, prefixState.pipe(Effect.map((use) => use.game)));
    if (game === undefined) return yield* stop(`Battle.net reported Warcraft III running, but its process didn't appear within ${DOCTOR_TIMEOUTS.gameProcess} s`);
    yield* say(`Battle.net started Warcraft III (pid ${game.pid})`);
    return true;
  });

  /** The launcher's state by its log: its sign-in form's page, or signed in. */
  const launcherNow = Effect.gen(function*() {
    const log = yield* loginLog((yield* prefixState).launcher);
    return log === undefined ? undefined : launcherHealth((yield* machine.read(join(logs, log)).pipe(Effect.mapError(failed))) ?? "");
  });
  const enter = (field: "username" | "password") => (hands.enterLogin === undefined ? stop("doctor has no hands to sign in") : hands.enterLogin(target, field).pipe(Effect.mapError(failed)));

  /** Types the account name, waits for the password page, types the password, then waits for the launcher's sign-in. */
  const signInWithAccount = Effect.gen(function*() {
    let health = yield* launcherNow;
    if (health?.kind === "sign-in form" && health.form === "Login") {
      yield* say("typing its account name");
      yield* enter("username");
      health = yield* poll(DOCTOR_TIMEOUTS.signInPage, launcherNow.pipe(Effect.map((now) => (now?.kind === "sign-in form" && now.form === "LoginCredential") || now?.kind === "signed in" ? now : undefined)));
      if (health === undefined) return yield* stop(`Battle.net didn't show its password page within ${DOCTOR_TIMEOUTS.signInPage} s of the account name`);
    }
    if (health?.kind === "sign-in form" && health.form === "LoginCredential") {
      yield* say("typing its password");
      yield* enter("password");
      const done = yield* poll(DOCTOR_TIMEOUTS.signInPage, launcherNow.pipe(Effect.map((now) => (now?.kind === "signed in" ? true : undefined))));
      if (done === undefined) return yield* stop(`Battle.net didn't sign in within ${DOCTOR_TIMEOUTS.signInPage} s of the password; check its sign-in window on display ${target.display ?? "?"}`);
    }
    if ((yield* launcherNow)?.kind === "signed in") yield* say("Battle.net signed in");
  });

  /** Waits up to LEAVE_SECONDS for the watch to show the client out of `kind`; the next look decides either way. */
  const left = (kind: StateKind) => waitFor(client, (view) => view.state.kind !== kind, { what: `leaving ${kind}`, seconds: LEAVE_SECONDS, failOn: [] }).pipe(Effect.ignore, Effect.asVoid);

  /**
   * Whether the watch shows the score screen now. Keys reach a client only
   * while it does: at the menus they could land in Battle.net's channel chat,
   * and a client the watch can't read gets none.
   */
  const onScoreScreen = watch.view(client).pipe(Effect.map((view) => view.state.kind === "results"), Effect.orElseSucceed(() => false));

  /** Whether this run launched the game: its game is waited on until it says where it is. */
  let started = false;
  const recover = (problem: Problem) => Effect.gen(function*() {
    switch (problem) {
      case "two runtimes":
      case "runtime without Battle.net":
      case "connection failing":
      case "launch failed":
        return yield* endPrefix;
      case "crashed":
      case "disconnected":
      case "empty login shell":
      case "map without its imports":
      case "stuck loading":
      case "hung startup":
        return yield* endGame;
      case "display settings changed": {
        const text = yield* machine.read(preferences).pipe(Effect.mapError(failed));
        if (text === undefined || target.settings === undefined) return;
        yield* machine.write(preferences, withPreferences(text, target.settings)).pipe(Effect.mapError(failed));
        return;
      }
      case "stale lobby":
        yield* hands.leaveLobby(target).pipe(Effect.mapError(failed));
        return yield* left("lobby");
      case "score screen": {
        for (let press = 1; press <= SCORE_ESCAPES; press++) {
          if (!(yield* onScoreScreen)) return;
          if (press > 1) yield* say(`still on the score screen; Escape again (${press} of ${SCORE_ESCAPES})`);
          yield* hands.closeScore(target).pipe(Effect.mapError(failed));
          yield* left("results");
        }
        if (!(yield* onScoreScreen)) return;
        yield* say(`still on the score screen after ${SCORE_ESCAPES} Escapes; ending Warcraft III so it starts again at the menus`);
        return yield* endGame;
      }
      case "closed":
        return yield* startLauncher;
      case "sign-in form":
        return yield* signInWithAccount;
      case "no game": {
        if (!hands.launches) return;
        if (!(yield* launchGame)) return "launch failed" as const;
        started = true;
        return;
      }
    }
  });

  const recovered: Problem[] = [];
  const tried = new Set<Problem>();
  let waiting: string | undefined;
  let next: Problem | undefined;
  while (true) {
    const diagnosis: Diagnosis = next === undefined
      ? diagnose(yield* observe, hands.launches, target.display, started, target.account !== undefined && hands.enterLogin !== undefined)
      : { kind: "problem", problem: next, detail: "Battle.net couldn't start Warcraft III" };
    next = undefined;
    switch (diagnosis.kind) {
      case "ready":
        yield* say(recovered.length === 0 ? `ready: ${diagnosis.detail}` : `ready: ${diagnosis.detail}, after ${recovered.join(", ")}`);
        return { client: name, state: diagnosis.detail, recovered } satisfies DoctorResult;
      case "stop":
        return yield* stop(diagnosis.problem);
      case "wait":
        if (waiting !== diagnosis.detail) yield* say(`${diagnosis.detail}...`);
        waiting = diagnosis.detail;
        yield* Effect.sleep(POLL);
        continue;
      case "problem": {
        waiting = undefined;
        const { problem } = diagnosis;
        // Each recovery runs once a run: a problem that comes back after it needs a person.
        if (tried.has(problem)) return yield* stop(`still ${problem} after ${RECOVERY[problem]} once (${diagnosis.detail})`);
        tried.add(problem);
        recovered.push(problem);
        yield* say(`${problem}: ${diagnosis.detail}; ${RECOVERY[problem]}`);
        const then = yield* recover(problem);
        if (then !== undefined) next = then;
        // A launcher restarted after a failed launch starts and launches once more, as `play` does.
        if (problem === "launch failed" || problem === "hung startup") {
          tried.delete("closed");
          tried.delete("no game");
        }
        since = undefined;
      }
    }
  }
});

/**
 * Signs a client out of Battle.net: ends every program of its prefix (SIGTERM,
 * SIGKILL after DOCTOR_TIMEOUTS.exit), then removes the launcher's saved login
 * from the prefix's user.reg, so its next start shows the sign-in form, which
 * doctor fills with the client's account.
 */
export const signOut = (target: DoctorTarget, print: (line: string) => void) => Effect.gen(function*() {
  const machine = yield* PlayMachine;
  const name = target.client.name;
  const failed = (cause: PlayProblem) => new DoctorStop({ problem: `${name}: ${cause.problem}` });
  const server = yield* machine.serverDirectory(target.prefix).pipe(Effect.mapError(failed));
  const programs = machine.processes.pipe(Effect.map((processes) => prefixUse(processes, target.prefix, server).processes), Effect.mapError(failed));
  const gone = (seconds: number) => pollFor(seconds, POLL, programs.pipe(Effect.map((left) => (left.length === 0 ? true : undefined)))).pipe(Effect.map((done) => done === true));
  const running = yield* programs;
  if (running.length > 0) {
    print(`${name}: ending every program of the prefix (pids ${pids(running)})`);
    yield* machine.signal(running.map(({ pid }) => pid), "SIGTERM");
    if (!(yield* gone(DOCTOR_TIMEOUTS.exit))) {
      yield* machine.signal((yield* programs).map(({ pid }) => pid), "SIGKILL");
      if (!(yield* gone(DOCTOR_TIMEOUTS.exit))) return yield* new DoctorStop({ problem: `${name}: can't end its programs: kill -9 ${pids(yield* programs)}` });
    }
  }
  const registry = join(target.prefix, "user.reg");
  const text = yield* machine.read(registry).pipe(Effect.mapError(failed));
  if (text === undefined || !hasSavedLogin(text)) {
    print(`${name}: signed out (no saved login in ${registry})`);
    return;
  }
  yield* machine.write(registry, withoutSavedLogin(text)).pipe(Effect.mapError(failed));
  print(`${name}: signed out: removed Battle.net's saved login; doctor signs it in again`);
});

/** Every target brought to a ready state at once; fails with one line per client that couldn't be. */
export const doctor = (targets: readonly DoctorTarget[], print: (line: string) => void) => Effect.gen(function*() {
  const results = yield* Effect.forEach(targets, (target) => doctorClient(target, print).pipe(Effect.result), { concurrency: "unbounded" });
  const stops = results.flatMap((result) => (result._tag === "Failure" ? [result.failure.problem] : []));
  if (stops.length > 0) return yield* new DoctorStop({ problem: stops.join("\n") });
  return results.flatMap((result) => (result._tag === "Success" ? [result.success] : []));
});

/** True when doctor recovered something, so a run that failed may now pass. */
export const recoveredAny = (results: readonly DoctorResult[]) => results.some((result) => result.recovered.length > 0);

/**
 * Runs `run` on healthy clients: `check` (a doctor run, such as
 * `doctor(targets, print)` with its services) first, and once more after a
 * failure; when that recovered something and `retry` allows (the default),
 * `run` tries again, up to `attempts` runs in all (2 by default). A failure doctor can't explain stands, and so does
 * any failure of a run that can't repeat (a capture into its own folder): its
 * clients are healed for the next run. `check` runs apart from `run`, so a
 * watch it holds (a menu report port) is free again while `run` runs.
 */
export const withDoctor = <A, E, R, E2, R2>(check: Effect.Effect<readonly DoctorResult[], E2, R2>, print: (line: string) => void, run: Effect.Effect<A, E, R>, { retry = true, attempts = 2 }: { readonly retry?: boolean; readonly attempts?: number } = {}) =>
  healedRun(check, print, run, retry, attempts);

const healedRun = <A, E, R, E2, R2>(check: Effect.Effect<readonly DoctorResult[], E2, R2>, print: (line: string) => void, run: Effect.Effect<A, E, R>, retry: boolean, attempts: number) => Effect.gen(function*() {
  yield* check;
  for (let attempt = 1; ; attempt++) {
    const result = yield* run.pipe(Effect.result);
    if (result._tag === "Success") return result.success;
    if (attempt >= attempts) return yield* Effect.fail(result.failure);
    print(`failed: ${(result.failure as { readonly message?: string }).message ?? String(result.failure)}; running doctor once`);
    if (!recoveredAny(yield* check) || !retry) return yield* Effect.fail(result.failure);
  }
});
