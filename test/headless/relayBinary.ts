import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect } from "effect";
import { relayBinary as builtRelay } from "../../host/net/localRelay";

/** The relay binary a test runs: `WISP_RELAY_BIN` when set, else the release build of relay/ that `net pair --relay local` makes with the pinned toolchain. */
export const relayBinary = (): Promise<string> => Effect.runPromise(builtRelay.pipe(Effect.provide(BunServices.layer)));
