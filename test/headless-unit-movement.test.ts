import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";
import { install, start } from "./unit-movement61/main";
import { UNIT_MOVEMENT_NOOPS } from "./unit-movement61/cases";

const runtime = installHeadless({ filePrefix: "unit-movement", globalPrefixes: ["__unitMovement"], intentionalNoops: UNIT_MOVEMENT_NOOPS });
afterAll(runtime.restore);

export const EXPECTED = [
  "fly-height-needs-crow-form=38400,38400",
  "move-speed-set-and-read=34560",
];

test("two fighter-body movement cases agree in two clients", () => {
  const clients = runtime.clients({ install, start });
  const result = runJourney(clients, { frames: 5, events: [] });
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`unit-movement-p${client.slot}.txt`)).toEqual(EXPECTED);
});
