import { parseNativeDeclarations } from "../../src/headless/declarations";
import { journeyLines, journeyProblems, runJourney } from "../../src/headless/journey";
import { warcraftLockstep } from "../../src/headless/lua";

const declarations = parseNativeDeclarations(`
declare function CreateTimer(this: void): timer;
declare function GetRandomReal(this: void, low: number, high: number): number;
`);

/** CreateTimer is the standalone profile; the run also calls GetRandomReal, which the profile leaves out. */
export function standaloneProfileRows(this: void): string[] {
  const result = runJourney(warcraftLockstep({
    declarations, players: [0], filePrefix: "profile", modules: { entry: "map", modules: [] }, standaloneProfile: ["CreateTimer"],
    natives: () => ({ GetRandomReal: () => 7 }),
    entry: (client) => ({ start: () => {
      (client.natives.CreateTimer as (this: void) => unknown)();
      (client.natives.GetRandomReal as (this: void) => unknown)();
    }, install: () => {} }),
  }), { frames: 1, events: [] });
  let refusal = "";
  try {
    warcraftLockstep({
      declarations, players: [0], filePrefix: "profile", modules: { entry: "map", modules: [] }, standaloneProfile: ["SetUnitX"],
      entry: () => ({ start: () => {}, install: () => {} }),
    });
  } catch (error) {
    refusal = String(error);
  }
  return [
    ...journeyLines(result).filter(line => line.includes("outside the standalone profile")),
    `problems ${journeyProblems(result)}`,
    refusal.includes("standalone profile native SetUnitX is not a declared native") ? "undeclared profile native refused" : `not refused: ${refusal}`,
  ];
}
