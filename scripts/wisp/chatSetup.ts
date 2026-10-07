import { Effect } from "effect";
import { DesktopFailure, waitFor } from "../warcraft/desktop";

export interface ChatEntry {
  readonly available: boolean;
  readonly open: boolean;
  readonly modified: number;
}

/** Observe Return's new publication; an old open file does not describe this game. */
export const openObservedChat = <E, R>(client: { readonly name: string }, entry: Effect.Effect<ChatEntry | undefined, E, R>, pressReturn: Effect.Effect<void, E, R>) => Effect.gen(function*() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = yield* waitFor(client, "chat entry ready", 8, entry);
    if (!before.available) return yield* new DesktopFailure({ operation: "open chat entry", client: client.name, cause: "the map cannot observe Warcraft's chat entry; no text sent" });
    yield* pressReturn;
    const current = yield* waitFor(client, "new chat entry after Return", 8, entry.pipe(Effect.map((value) => value !== undefined && value.available && value.modified > before.modified ? value : undefined)));
    if (current.open) return;
  }
  return yield* new DesktopFailure({ operation: "open chat entry", client: client.name, cause: "chat stayed closed after two observed Return transitions; no text sent" });
});

export interface CommandReceipt<A, E, R> {
  readonly client: { readonly name: string };
  readonly read: Effect.Effect<A | undefined, E, R>;
  readonly requested: (current: A, before: A | undefined) => boolean;
}

/** Snapshot before sending, then require each selected client's new requested receipt. */
export const confirmedCommand = <A, E, R>(command: string, receipts: readonly CommandReceipt<A, E, R>[], send: Effect.Effect<void, E, R>) => Effect.gen(function*() {
  const before = yield* Effect.forEach(receipts, (target) => target.read);
  yield* send;
  return yield* Effect.forEach(receipts, (target, index) => waitFor(target.client, `${command} map receipt`, 8, target.read.pipe(Effect.map((current) => current !== undefined && target.requested(current, before[index]) ? current : undefined))));
});
