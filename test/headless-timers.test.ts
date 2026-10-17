import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../host/headless/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./timers56/main";
import * as timer134 from "./timer134/main";
import { EXPECTED } from "./timers56/expected";
import { NATIVE_134_STEPS } from "./timer134/native";

const runtime = installHeadless({ filePrefix: "timers56", globalPrefixes: ["__timers56", "__timer134"] });
afterAll(runtime.restore);

test("each timer rule's row agrees in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 76, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`timers56-p${client.slot}.txt`)).toEqual(EXPECTED);
});

const nativeReadings = (): number[] => {
  let reading = 0;
  return [...NATIVE_134_STEPS].flatMap(digit => [8, 4, 2, 1].map(bit => (reading += (Number.parseInt(digit, 16) & bit) === 0 ? 1092 : 1093)));
};

test("[native wisp#134, timer134-a/b, 3.0.0.24268] TimerGetElapsed inside 1/60 s and 1/1024 s callbacks matches native's deadlines except a pinned 280-reading residual from callback 3,364", () => {
  let state: { readings: number[]; fastReadings: number[] } | undefined;
  const clients = runtime.clients({ install: timer134.install, start: () => { timer134.start(); state = globalThis.__timer134; } }, [0]);
  clients.start();
  while ((state?.readings.length ?? 0) < timer134.TIMER134_CALLBACKS) clients.frames(60);
  expect(state?.fastReadings).toEqual(Array.from({ length: timer134.TIMER134_FAST_CALLBACKS }, (_, index) => 64 * (index + 1)));
  const native = nativeReadings();
  const residuals = (state?.readings ?? []).flatMap((reading, index) => reading === native[index] ? [] : [[index + 1, reading - (native[index] ?? Number.NaN)]]);
  const expected = [...Array.from({ length: 120 }, (_, index) => 3364 + 4 * index), ...Array.from({ length: 160 }, (_, index) => 3841 + index)];
  expect(residuals).toEqual(expected.map(callback => [callback, 1]));
});
