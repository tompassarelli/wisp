import { Console, Effect, Schema } from "effect";
import { pollUntil } from "../cli/hostProcess";
import { recordHold } from "./holdLog";

export const RELEASE_AFTER_SECONDS = 600;

const PairIdleness = Schema.Struct({ idleSeconds: Schema.Int });

const IDLE_POLL = "5 seconds";

/** Whether a pool's native checks have ended, so it lets go of its pairs: every pair it runs has been idle (no live driver, no game in progress; `idleness`, which counts 0 while busy or dead) for at least `releaseAfter` seconds. */
const checksEnded = (pairs: readonly { readonly idleSeconds: number }[], releaseAfter: number) =>
  pairs.every(({ idleSeconds }) => idleSeconds >= releaseAfter);

/** Succeeds once every pair in `pairs` has been idle for `releaseAfter` seconds, read through `status`: the native check or capture batch that drove it has ended. A pair whose status doesn't answer counts as busy. Each read sets `busyAt` for its pair to when it was last busy (ms). */
const checksDone = <E, R>(status: (pair: number) => Effect.Effect<unknown, E, R>, pairs: readonly number[], releaseAfter: number, busyAt: Map<number, number>) => pollUntil(
  Effect.forEach(pairs, (pair) => status(pair).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(PairIdleness)),
    Effect.orElseSucceed(() => ({ idleSeconds: 0 })),
    Effect.tap(({ idleSeconds }) => Effect.sync(() => busyAt.set(pair, Date.now() - idleSeconds * 1000))),
  )),
  { until: (reads) => releaseAfter > 0 && checksEnded(reads, releaseAfter), every: IDLE_POLL },
).pipe(Effect.andThen(Console.log(`pair${pairs.length === 1 ? "" : "s"} ${pairs.join(", ")}: idle ${releaseAfter} s since the last check; releasing`)));

/** Races a pool's `lasting` run against its checks ending: succeeds with no pairs when the run ends first, or with `pairs` once every one has been idle `releaseAfter` seconds (never, when `releaseAfter` is 0). */
const poolEnds = <A, E, R, E2, R2>(lasting: Effect.Effect<A, E, R>, status: (pair: number) => Effect.Effect<unknown, E2, R2>, pairs: readonly number[], releaseAfter: number, busyAt: Map<number, number>) =>
  Effect.raceFirst(
    lasting.pipe(Effect.as<readonly number[]>([])),
    checksDone(status, pairs, releaseAfter, busyAt).pipe(Effect.as<readonly number[]>(pairs)),
  );

/** `poolEnds`, and when the pool's scope closes, however it ends, one `holds.jsonl` record of each pair in `pairs` for `owner`: whether its checks ended or its run did, and when the pair was last busy by the last status read. */
export const holdPairs = <A, E, R, E2, R2>(lasting: Effect.Effect<A, E, R>, status: (pair: number) => Effect.Effect<unknown, E2, R2>, pairs: readonly number[], releaseAfter: number, owner: string) => Effect.gen(function*() {
  const busyAt = new Map<number, number>();
  let how: "released" | "stopped" = "stopped";
  yield* Effect.addFinalizer(() => Effect.sync(() => {
    const end = Date.now();
    for (const pair of pairs) recordHold({ pair, owner, end: new Date(end).toISOString(), lastBusy: new Date(busyAt.get(pair) ?? end).toISOString(), how });
  }));
  const released = yield* poolEnds(lasting, status, pairs, releaseAfter, busyAt);
  if (released.length > 0) how = "released";
  return released;
});
