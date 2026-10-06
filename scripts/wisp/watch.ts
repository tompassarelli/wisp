// What each Warcraft III client is doing, from events rather than its screen:
// the menus' socket (wisp:docs/driving-warcraft.md), Warcraft III's own log
// (War3Log.txt), the map's receipts in CustomMapData, and the processes in the
// client's Wine prefix. Nothing here captures or reads the screen.
import { Clock, Context, Effect, Schema } from "effect";
import type { LadderScan } from "../warcraft/war3Log";
import type { Client } from "./clients";

/** Where a state or event was learned. */
export type Source = "socket" | "log" | "receipt" | "process";

/** One client's state. `kind` names it; the rest is what the source said. */
export type ClientState =
  /** Neither Battle.net nor Warcraft III runs in the client's prefix. */
  | { readonly kind: "closed" }
  /** Battle.net runs; Warcraft III doesn't. */
  | { readonly kind: "launcher" }
  /** Warcraft III started; the login doors haven't closed. */
  | { readonly kind: "signing in" }
  /** Signed in; the menus haven't reported a screen yet. */
  | { readonly kind: "signed in" }
  /** A menu screen, as the game names it (`MAIN_MENU`, `CUSTOM_CAMPAIGN`, `CUSTOM_GAMES`, ...). */
  | { readonly kind: "menus"; readonly screen: string }
  /** In a lobby; `host` when this client hosts it. */
  | { readonly kind: "lobby"; readonly host?: boolean; readonly map?: string }
  | { readonly kind: "loading"; readonly map?: string }
  | { readonly kind: "in match"; readonly map?: string }
  /** The score screen after a match. */
  | { readonly kind: "results" }
  /** Warcraft III runs but has lost Battle.net. */
  | { readonly kind: "disconnected"; readonly reason: string }
  /** Warcraft III stopped without being closed, or wrote a crash report. */
  | { readonly kind: "crashed"; readonly reason: string };

export type StateKind = ClientState["kind"];

/** A client as last observed. */
export interface ClientView {
  readonly client: string;
  readonly state: ClientState;
  /** Which source decided `state`, the line or message that did, and when it was observed (ms since the epoch). */
  readonly source: Source;
  readonly evidence: string;
  readonly at: number;
  /** The newest session's post-sign-in ladder map scan (wisp:scripts/warcraft/war3Log.ts). */
  readonly scan: LadderScan["kind"];
  /** Models the newest session's map couldn't create: "model creation failed - war3mapImported/...". */
  readonly loadErrors: { readonly count: number; readonly first?: string };
}

/** A change in a client's view, as `wisp watch` prints it. */
export type WatchEvent =
  | { readonly type: "state"; readonly client: string; readonly at: number; readonly source: Source; readonly state: ClientState; readonly evidence: string }
  | { readonly type: "ladder scan"; readonly client: string; readonly at: number; readonly source: "log"; readonly scan: LadderScan["kind"] }
  | { readonly type: "load errors"; readonly client: string; readonly at: number; readonly source: "log"; readonly count: number; readonly first?: string };

export class WatchFailure extends Schema.TaggedError<WatchFailure>()("WatchFailure", {
  client: Schema.String,
  operation: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.operation} failed for ${this.client}: ${this.problem}`;
  }
}

/** Every watched client's current view. */
export class ClientWatch extends Context.Service<ClientWatch, {
  readonly view: (client: Client) => Effect.Effect<ClientView, WatchFailure>;
}>()("wisp/ClientWatch") {}

export interface WaitOptions {
  /** What is awaited, for the failure message. */
  readonly what?: string;
  readonly seconds?: number;
  /** States that end the wait with a failure unless the predicate accepts them first. Default: crashed, disconnected. */
  readonly failOn?: readonly StateKind[];
}

const POLL = "100 millis";
const FAIL_ON: readonly StateKind[] = ["crashed", "disconnected"];

const describe = (view: ClientView) => {
  const { state } = view;
  const detail = "reason" in state ? `: ${state.reason}` : "screen" in state ? ` (${state.screen})` : "";
  return `${state.kind}${detail}, by ${view.source}: ${view.evidence}`;
};

/**
 * Waits until `predicate` accepts the client's view and returns that view.
 * A state in `failOn` (crashed or disconnected by default) fails at once.
 */
export const waitFor = (client: Client, predicate: (view: ClientView) => boolean, options: WaitOptions = {}) => Effect.gen(function*() {
  const watch = yield* ClientWatch;
  const { what = "a state", seconds = 60, failOn = FAIL_ON } = options;
  const deadline = (yield* Clock.currentTimeMillis) + seconds * 1000;
  let last: ClientView | undefined;
  while (true) {
    const view = yield* watch.view(client);
    last = view;
    if (predicate(view)) return view;
    if (failOn.includes(view.state.kind)) return yield* new WatchFailure({ client: client.name, operation: `wait for ${what}`, problem: describe(view) });
    if ((yield* Clock.currentTimeMillis) > deadline) {
      return yield* new WatchFailure({ client: client.name, operation: `wait for ${what}`, problem: `not within ${seconds} s; last ${describe(last)}` });
    }
    yield* Effect.sleep(POLL);
  }
});

/** A predicate for one of these states. */
export const inState = (...kinds: readonly StateKind[]) => (view: ClientView) => kinds.includes(view.state.kind);
