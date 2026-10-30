// One measured run of the window probe, started by `wisp window probe` with the JavaScript collector's log on stderr: probeChild.ts GAME_MODULE EXPORT TITLE FRAMES WARMUP RAW.json; a failed run writes {"failure": text} to RAW.json, because stderr carries the collector's log
import { Effect } from "effect";
import { describeCause } from "../cli/command";
import { measureWindow } from "./probe";

const [modulePath, exportName, title, frames, warmup, out] = process.argv.slice(2);
if (modulePath === undefined || exportName === undefined || title === undefined || frames === undefined || warmup === undefined || out === undefined) throw new Error("usage: probeChild.ts GAME_MODULE EXPORT TITLE FRAMES WARMUP RAW.json");
const samples = await Effect.runPromise(measureWindow({ module: modulePath, export: exportName }, title, Number(frames), Number(warmup)).pipe(
  Effect.catch((failure) => Effect.promise(async () => {
    await Bun.write(out, JSON.stringify({ failure: describeCause(failure) }));
    process.exit(1);
  })),
));
await Bun.write(out, JSON.stringify(samples));
process.exit(0);
