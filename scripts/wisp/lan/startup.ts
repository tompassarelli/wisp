import { Effect, Schedule } from "effect";
import { LanFailure } from "./join";

/** Starts each client in order; a failed first-client check must finish before the peer can be launched. */
export const startPairClients = <T, E, R>(clients: readonly T[], start: (client: T) => Effect.Effect<void, E, R>, locateFirst?: (client: T) => Effect.Effect<void, E, R>) =>
  Effect.forEach(clients, (client, index) => index === 0 && locateFirst !== undefined ? Effect.andThen(start(client), locateFirst(client)) : start(client), { discard: true });

/** Polls every 250 ms until the first Warcraft process runs; fails when its launcher stops or after 60 s. */
export const waitForFirstClient = <E, R>(ready: Effect.Effect<boolean, E, R>, stopped: Effect.Effect<boolean, E, R>) =>
  Effect.gen(function*() {
    if (yield* stopped) return yield* new LanFailure({ problem: "the first client's native launcher stopped before Warcraft started" });
    return yield* ready;
  }).pipe(
    Effect.repeat({ schedule: Schedule.spaced("250 millis"), until: (started) => started }),
    Effect.timeoutOrElse({ duration: "60 seconds", orElse: () => Effect.fail(new LanFailure({ problem: "the first Warcraft process did not start within 60 s" })) }),
    Effect.asVoid,
  );
