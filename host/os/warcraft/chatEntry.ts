import { Effect } from "effect";
import { pollFor } from "../../process/hostProcess";
import type { Frame } from "../platform/services";
import { DesktopFailure, type Region } from "./desktopClient";

export interface ChatEntryBand {
  readonly region: Region;
  readonly minRun: number;
}

// Warcraft 3.0 draws its open chat entry as a box with one-pixel gold top and bottom borders, about half the 4:3 UI wide, three quarters down the window.
export const chatEntryBand = (window: Region): ChatEntryBand => ({
  region: { x: window.x, y: window.y + Math.round(window.height * 0.7), width: window.width, height: Math.round(window.height * 0.12) },
  minRun: Math.round(window.height * 4 / 3 * 0.4),
});

const borderGold = (rgb: Uint8Array, at: number) => rgb[at]! > 180 && rgb[at + 1]! > 130 && rgb[at + 2]! < 90;

export function chatEntryOpen(frame: Frame, minRun: number): boolean {
  let borders = 0;
  for (let y = 0; y < frame.height; y++) {
    let run = 0;
    let longest = 0;
    for (let x = 0; x < frame.width; x++) {
      run = borderGold(frame.rgb, (y * frame.width + x) * 3) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    if (longest >= minRun) borders++;
  }
  return borders >= 2;
}

export interface ChatSteps<E, R> {
  readonly open: Effect.Effect<boolean, E, R>;
  readonly pressReturn: Effect.Effect<void, E, R>;
  readonly sendLine: Effect.Effect<void, E, R>;
  readonly seconds?: number;
}

export const sendCheckedChat = <E, R>(client: { readonly name: string }, steps: ChatSteps<E, R>) => Effect.gen(function*() {
  const seconds = steps.seconds ?? 3;
  const until = (open: boolean) => pollFor(seconds, "50 millis", steps.open.pipe(Effect.map((seen) => (seen === open ? true : undefined))));
  if (yield* steps.open) return yield* new DesktopFailure({ operation: "send chat", client: client.name, cause: "Warcraft's chat entry is already open; nothing sent (close it with `client keys CLIENT Escape`)" });
  yield* steps.pressReturn;
  if ((yield* until(true)) === undefined) return yield* new DesktopFailure({ operation: "open chat", client: client.name, cause: `Warcraft's chat entry stayed closed ${seconds} s after Return, so keys are not reaching the game; nothing typed` });
  yield* steps.sendLine;
  if ((yield* until(false)) === undefined) return yield* new DesktopFailure({ operation: "send chat", client: client.name, cause: `Warcraft's chat entry was still open ${seconds} s after the closing Return; the line was not sent` });
});
