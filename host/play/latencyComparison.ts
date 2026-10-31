import { Schema } from "effect";

const Spread = Schema.Struct({ p50: Schema.Finite, p95: Schema.Finite });

/** The figures of a `press-latency.json` that the native window's acceptance reads. */
export const PressRun = Schema.Struct({
  window: Schema.String,
  trials: Schema.Finite,
  responded: Schema.Finite,
  pressMs: Spread,
});
export type PressRun = typeof PressRun.Type;

export const decodePressRun = Schema.decodeUnknownSync(PressRun);

/** `latency.json`: the native run's report with the Warcraft run it is judged against beside it; the Warcraft block is absent when no run was given, so the acceptance check cannot pass on the native figures alone. */
export function latencyReport<Native extends PressRun>(native: Native, warcraft: PressRun | undefined) {
  return warcraft === undefined ? native : { ...native, warcraft: { window: warcraft.window, trials: warcraft.trials, responded: warcraft.responded, pressMs: warcraft.pressMs } };
}
