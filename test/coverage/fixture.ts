import { Lockstep } from "../../src/headless/lockstep";
import { parseNativeDeclarations } from "../../src/headless/declarations";
import { journeyProblems, runJourney } from "../../src/headless/journey";

const declarations = parseNativeDeclarations(`
declare function GetRandomInt(this: void, low: number, high: number): number;
declare function GetRandomReal(this: void, low: number, high: number): number;
declare function StopMusic(this: void, fade: boolean): void;
declare function CreateTimer(this: void): timer;
`);

export function coverageFixture(this: void): void {
  const play = (known: boolean) => runJourney(new Lockstep({
    declarations, players: [0, 1], filePrefix: "coverage", modules: { entry: "map", modules: [] },
    localNatives: { GetRandomInt: "exercise coverage of local-only calls" },
    ...(known ? { intentionalNoops: { StopMusic: "this logic fixture has no music playback" }, natives: () => ({ GetRandomReal: () => 7 }) } : {}),
    entry: (client) => ({ start: () => {
      const call = (name: string) => (client.natives[name] as (this: void) => unknown)();
      call("CreateTimer");
      if (known) {
        if (call("GetRandomReal") !== 7) throw new Error("consumer behavior did not run");
        call("StopMusic");
      } else {
        call("GetRandomInt");
        call("GetRandomInt");
      }
    }, install: () => {} }),
  }), { frames: 1, events: [] });
  const unknown = play(false);
  if (unknown.divergence !== undefined || journeyProblems(unknown) !== 2) throw new Error("equal native defaults masked missing behavior");
  for (const client of unknown.clients) {
    const missing = client.missingNatives[0];
    if (client.missingNatives.length !== 1 || missing?.native !== "GetRandomInt" || missing.client !== client.slot || missing.frame !== 0) throw new Error("missing call has no native/client/frame");
  }
  if (journeyProblems(play(true)) !== 0) throw new Error("built-in, consumer behavior or explicit no-op failed");
}
