// One measured run of the window probe, started by `wisp window probe` with the JavaScript collector's log on stderr: probeChild.ts GAME_MODULE FRAMES WARMUP RAW.json
import { Effect } from "effect";
import { measureWindow } from "./probe";
import type { StandaloneGame } from "../play/standalone";

export const FRAMES_BEGIN = "wisp-window-probe frames begin";
export const FRAMES_END = "wisp-window-probe frames end";

const [modulePath, frames, warmup, out] = process.argv.slice(2);
if (modulePath === undefined || frames === undefined || warmup === undefined || out === undefined) throw new Error("usage: probeChild.ts GAME_MODULE FRAMES WARMUP RAW.json");
const module = await import(modulePath) as { readonly sampleGame?: StandaloneGame };
if (module.sampleGame === undefined) throw new Error(`${modulePath} exports no sampleGame`);
console.error(FRAMES_BEGIN);
const samples = await Effect.runPromise(measureWindow(module.sampleGame, Number(frames), Number(warmup)));
console.error(FRAMES_END);
await Bun.write(out, JSON.stringify(samples));
process.exit(0);
