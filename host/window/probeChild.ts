// One measured run of the window probe, started by `wisp window probe` with the JavaScript collector's log on stderr: probeChild.ts GAME_MODULE EXPORT TITLE FRAMES WARMUP RAW.json
import { Effect } from "effect";
import { measureWindow } from "./probe";

const [modulePath, exportName, title, frames, warmup, out] = process.argv.slice(2);
if (modulePath === undefined || exportName === undefined || title === undefined || frames === undefined || warmup === undefined || out === undefined) throw new Error("usage: probeChild.ts GAME_MODULE EXPORT TITLE FRAMES WARMUP RAW.json");
const samples = await Effect.runPromise(measureWindow({ module: modulePath, export: exportName }, title, Number(frames), Number(warmup)));
await Bun.write(out, JSON.stringify(samples));
process.exit(0);
