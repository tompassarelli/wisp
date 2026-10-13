import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./timers56/main";
import * as timer134 from "./timer134/main";
import { EXPECTED } from "./timers56/expected";

const runtime = installHeadless({ filePrefix: "timers56", globalPrefixes: ["__timers56", "__timer134"] });
afterAll(runtime.restore);

test("each timer rule's row agrees in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 76, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`timers56-p${client.slot}.txt`)).toEqual(EXPECTED);
});

// wisp#134 readings on 3.0.0.24268, awaiting an outside-the-game measurement (README, Respecting Blizzard's IP): [callback, frame] and [callback, TimerGetElapsed(128 s reference) × 65536]. From callback 3,364 native reads 1/65536 s lower in 280 of 637 readings, a TimerGetElapsed rounding the frames do not depend on.
const NATIVE_134_FRAMES = [[1, 1], [1000, 1000], [2000, 2000], [3000, 3000], [3823, 3823], [4000, 4000]] as const;
// Each reading's third value is headless minus native.
const NATIVE_134_READINGS = [[1, 1092, 0], [1000, 1092254, 0], [2000, 2184504, 0], [3000, 3276754, 0], [3364, 3674332, 1], [3823, 4175675, 0], [3841, 4195335, 1], [4000, 4368963, 1]] as const;

test("[native wisp#134] a 1/60 s periodic timer fires in native's frame through callback 4,000", () => {
  let state: { count: number; chunks: string[] } | undefined;
  const clients = runtime.clients({ install: timer134.install, start: () => { timer134.start(); state = globalThis.__timer134; } }, [0], { effectStepMs: 25 });
  clients.start();
  const frames: number[] = [];
  while (frames.length < timer134.TIMER134_CALLBACKS) {
    clients.frames(1);
    while (frames.length < (state?.count ?? 0)) frames.push(clients.frame);
  }
  const readings = (state?.chunks ?? []).flatMap(chunk => chunk.split(",").filter(value => value !== "").map(Number));
  expect(NATIVE_134_FRAMES.map(([callback]) => [callback, frames[callback - 1]])).toEqual([...NATIVE_134_FRAMES]);
  expect(NATIVE_134_READINGS.map(([callback, native]) => [callback, (readings[callback - 1] ?? Number.NaN) - native])).toEqual(NATIVE_134_READINGS.map(([callback, , offset]) => [callback, offset]));
});
