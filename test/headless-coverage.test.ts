import { expect, test } from "bun:test";
import { coverageFixture } from "./coverage/fixture";
import { standaloneProfile } from "../host/headless/standaloneProfile";
import { parseNativeDeclarations } from "../src/headless/declarations";
import { journeyLines, journeyProblems, runJourney } from "../src/headless/journey";
import { Lockstep } from "../src/headless/lockstep";

test("equal defaults fail coverage, modeled and intentional calls pass in Bun", coverageFixture);

test("a native outside the standalone profile fails naming it, even when modeled", () => {
  const declarations = parseNativeDeclarations(`
declare function CreateTimer(this: void): timer;
declare function GetRandomReal(this: void, low: number, high: number): number;
`);
  const profile = standaloneProfile("local t = CreateTimer()\nprint(\"GetRandomInt\")", declarations);
  expect(profile).toEqual(["CreateTimer"]);
  const result = runJourney(new Lockstep({
    declarations, players: [0], filePrefix: "profile", modules: { entry: "map", modules: [] }, standaloneProfile: profile,
    natives: () => ({ GetRandomReal: () => 7 }),
    entry: (client) => ({ start: () => {
      (client.natives.CreateTimer as (this: void) => unknown)();
      (client.natives.GetRandomReal as (this: void) => unknown)();
    }, install: () => {} }),
  }), { frames: 1, events: [] });
  expect(journeyLines(result)).toContain("p0 frame 0: native GetRandomReal is outside the standalone profile");
  expect(journeyProblems(result)).toBe(1);
  expect(() => new Lockstep({ declarations, players: [0], filePrefix: "profile", modules: { entry: "map", modules: [] }, standaloneProfile: ["SetUnitX"], entry: () => ({ start: () => {}, install: () => {} }) }))
    .toThrow("standalone profile native SetUnitX is not a declared native");
});
