import { expect, test } from "bun:test";
import { Random } from "../src/headless/random";
import { installHeadless } from "../scripts/wisp/headless";
import { playSoakMatch, soakRepro, type SoakInputs } from "../scripts/wisp/soak";
import { assertSoakReproFixed, shrinkSoakRepro } from "../scripts/wisp/reproShrink";
import game from "./soak/shrinkGame";
import project from "./soak/shrinkProject";

export function seededTwoInputRepro() {
  const random = new Random(734);
  const required = [[17, 0, { button: 0, down: true }], [95, 1, { button: 1, down: true }]] as const;
  const inputs: SoakInputs = {
    edges: [...Array.from({ length: 100 }, (_, index) => [index + 1, 0, { axis: 0, value: random.between(-127, 127) }] as const), ...required].sort((a, b) => a[0] - b[0]),
    silences: [], hitches: [], slow: [],
  };
  const runtime = installHeadless(project.map);
  try {
    return { required, repro: soakRepro(project.name, playSoakMatch(runtime, game, project, { index: 0, seed: 734, fighters: ["a", "b"], stage: "flat", policies: ["fuzz", "fuzz"], frames: 600 }, inputs)) };
  } finally {
    runtime.restore();
  }
}

test("a seeded failure shrinks to exactly its two required inputs and keeps the original intact", () => {
  const { required, repro } = seededTwoInputRepro();
  const saved = JSON.stringify(repro);
  const shrunk = shrinkSoakRepro(project, game, repro);
  expect(shrunk.before).toBe(102);
  expect(shrunk.after).toBe(2);
  expect(shrunk.repro.inputs.edges).toEqual(required);
  expect(shrunk.repro.findings[0]?.kind).toBe("game");
  expect(JSON.stringify(repro)).toBe(saved);
  expect(() => assertSoakReproFixed(project, game, shrunk.repro)).toThrow("game");
  expect(() => assertSoakReproFixed(project, game, { ...shrunk.repro, inputs: { ...shrunk.repro.inputs, edges: [required[0]] } })).not.toThrow();
  expect(() => shrinkSoakRepro(project, game, { ...repro, findings: [{ kind: "stall", frame: 0, text: "a different failure" }] })).toThrow("no longer fails with stall");
});
