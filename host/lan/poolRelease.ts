import { Console, Effect, Schema } from "effect";
import { pollUntil } from "../cli/hostProcess";

export const RELEASE_AFTER_SECONDS = 600;

const PairIdleness = Schema.Struct({ idleSeconds: Schema.Int });

const IDLE_POLL = "5 seconds";

/** Whether a pool's native checks have ended, so it lets go of its pairs: every pair it runs has been idle (no live driver, no game in progress; `idleness`, which counts 0 while busy or dead) for at least `releaseAfter` seconds. */
const checksEnded = (pairs: readonly { readonly idleSeconds: number }[], releaseAfter: number) =>
  pairs.every(({ idleSeconds }) => idleSeconds >= releaseAfter);

/** Succeeds once every pair in `pairs` has been idle for `releaseAfter` seconds, read through `status`: the native check or capture batch that drove it has ended. A pair whose status doesn't answer counts as busy. */
const checksDone = <E, R>(status: (pair: number) => Effect.Effect<unknown, E, R>, pairs: readonly number[], releaseAfter: number) => pollUntil(
  Effect.forEach(pairs, (pair) => status(pair).pipe(Effect.flatMap(Schema.decodeUnknownEffect(PairIdleness)), Effect.orElseSucceed(() => ({ idleSeconds: 0 })))),
  { until: (reads) => checksEnded(reads, releaseAfter), every: IDLE_POLL },
).pipe(Effect.andThen(Console.log(`pair${pairs.length === 1 ? "" : "s"} ${pairs.join(", ")}: idle ${releaseAfter} s since the last check; releasing`)));

/** Races a pool's `lasting` run against its checks ending: succeeds with no pairs when the run ends first, or with `pairs` once every one has been idle `releaseAfter` seconds (never, when `releaseAfter` is 0). */
export const poolEnds = <A, E, R, E2, R2>(lasting: Effect.Effect<A, E, R>, status: (pair: number) => Effect.Effect<unknown, E2, R2>, pairs: readonly number[], releaseAfter: number) =>
  Effect.raceFirst(
    lasting.pipe(Effect.as<readonly number[]>([])),
    (releaseAfter > 0 ? checksDone(status, pairs, releaseAfter) : Effect.never).pipe(Effect.as<readonly number[]>(pairs)),
  );
