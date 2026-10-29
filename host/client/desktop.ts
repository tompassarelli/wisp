import { Effect } from "effect";
import { ClientWatch, describeView, typesIntoMatch } from "../dev/watch";
import { chatEntryBand, chatEntryOpen, sendCheckedChat } from "../os/warcraft/chatEntry";
import { capture, focus } from "../os/warcraft/desktop";
import { type Client, DesktopFailure } from "../os/warcraft/desktopClient";
import { type InputAction, sendsChat } from "../os/warcraft/inputBatch";
import { InputInjection } from "../os/platform/services";

export * from "../os/warcraft/desktop";

const requireMatch = (client: Client, input: string) =>
  Effect.gen(function*() {
    const provided = yield* Effect.serviceOption(ClientWatch);
    const view = yield* (provided._tag === "Some"
      ? provided.value.view(client)
      : ClientWatch.use((watch) => watch.view(client)).pipe(Effect.provide(ClientWatch.layer())));
    if (!typesIntoMatch(view)) {
      return yield* new DesktopFailure({
        operation: `send ${input}`,
        client: client.name,
        cause: `refused outside a match its menu page reports, where it would reach Battle.net's channel or a lobby's chat; now ${describeView(view)}${view.menus === true ? "" : " (no menu page connected)"}`,
      });
    }
  }).pipe(Effect.catchTag("WatchFailure", (cause) => Effect.fail(new DesktopFailure({ operation: `send ${input}`, client: client.name, cause }))));

export const keys = (client: Client, ...names: string[]) =>
  Effect.gen(function*() {
    if (sendsChat(names)) yield* requireMatch(client, names.join(" "));
    yield* focus(client);
    yield* InputInjection.use((input) => input.keys(client, names));
  });

export const typeText = (client: Client, value: string, delayMillis?: number) =>
  Effect.gen(function*() {
    yield* requireMatch(client, "typed text");
    yield* focus(client);
    yield* InputInjection.use((input) => input.typeText(client, value, delayMillis));
  });

export const batch = Effect.fnUntraced(function*(client: Client, actions: readonly InputAction[]) {
  if (actions.length === 0) return;
  if (actions.some((action) => action.kind === "text" || (action.kind === "keys" && sendsChat(action.keys)))) yield* requireMatch(client, "typed text or Return");
  yield* focus(client);
  yield* InputInjection.use((input) => input.batch(client, actions));
});

export const chat = Effect.fnUntraced(function*(client: Client, line: string) {
  yield* requireMatch(client, "chat");
  yield* focus(client);
  const input = yield* InputInjection;
  const band = chatEntryBand(yield* input.windowRegion(client));
  yield* sendCheckedChat(client, {
    open: capture(client, band.region).pipe(Effect.map((frame) => chatEntryOpen(frame, band.minRun))),
    pressReturn: input.batch(client, [{ kind: "keys", keys: ["Return"] }]),
    sendLine: input.batch(client, [{ kind: "text", text: line }, { kind: "keys", keys: ["Return"] }]),
  });
});
