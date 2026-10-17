import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../host/headless/headless";
import { runJourney } from "../src/headless/journey";
import { ANIMATION_NOOPS } from "./animation58/cases";
import { EXPECTED, EXPECTED_FILE } from "./animation58/expected";
import { CAPTURE_FRAME, RULER, RULER_DEATH_SECONDS } from "./animation58/layout";
import { install, start } from "./animation58/main";
import { animationRows } from "./animation58/rows";

const runtime = installHeadless({ filePrefix: "animation", globalPrefixes: ["__animation58"], intentionalNoops: ANIMATION_NOOPS });
afterAll(runtime.restore);
const effectDeaths = (model: string) => (model === RULER ? RULER_DEATH_SECONDS : undefined);

test("the playback and effect lifetime rulers draw the same rows and files in two clients, with no divergence, errors or missing natives", () => {
  const clients = runtime.clients({ install, start }, [0, 1], { effectDeaths });
  const result = runJourney(clients, { frames: CAPTURE_FRAME, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => [client.errors, client.missingNatives])).toEqual([[[], []], [[], []]]);
  for (const client of clients.clients) {
    expect(client.files.get(`animation-p${client.slot}.txt`)).toEqual(EXPECTED_FILE);
    expect(animationRows(client.effectPoses(), client.unitPoses())).toEqual(EXPECTED);
  }
});
