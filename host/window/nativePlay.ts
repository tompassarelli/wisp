import { Effect } from "effect";
import { RenderFailure } from "../render/headlessRender";
import { WAKE_ERROR, WAKE_FRAME, openNativeWindow } from "./binding";
import { type FrameLoop, type NativePlayer, createFrameLoop } from "./frameLoop";

export type { NativePlayer } from "./frameLoop";

export interface NativePlayOptions {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly scripted: boolean;
}

export const NATIVE_HELP = "Arrows / WASD move · J attack · K special · Space jump · L grab · Shift shield · Enter pause";

/** Opens the native window for `player` and steps it on Bun's main thread, where the game's collections then run; `closed` ends when the player closes the window before the run completes. */
export const openNativePlayer = (player: NativePlayer, options: NativePlayOptions) => Effect.gen(function*() {
  const opened = performance.now();
  const closing = Promise.withResolvers<void>();
  let loop: FrameLoop | undefined;
  const window = yield* Effect.acquireRelease(
    Effect.try({
      try: () => openNativeWindow({
        ...options,
        onWake: (kind, _frame, sampleNs, mask, handledNs) => {
          if (kind === WAKE_FRAME) loop?.tick(sampleNs, handledNs, mask);
          else if (kind === WAKE_ERROR) loop?.complete(window.error() ?? "the window failed");
          else closing.resolve();
        },
      }),
      catch: (cause) => new RenderFailure({ cause }),
    }),
    (open) => Effect.sync(() => { loop?.dispose(); open.close(); }),
  );
  window.status(`${options.title} · loading game…`);
  loop = createFrameLoop(player, window, { scripted: options.scripted, startupMs: performance.now() - opened }, (result) => { void player.finish(result).catch(() => undefined); });
  window.status(`${options.title} · ${options.scripted ? "scripted run" : NATIVE_HELP}`);
  window.start();
  return { closed: Effect.promise(() => closing.promise) };
});
