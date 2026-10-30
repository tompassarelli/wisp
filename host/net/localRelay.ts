import { join } from "node:path";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";
import { collect } from "../process/hostProcess";
import { NetFailure } from "./failure";
import type { Endpoint } from "./link";

const relayDirectory = join(import.meta.dir, "../../relay");

const freePort = Effect.tryPromise({
  try: async () => {
    const probe = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
    const port = probe.port;
    probe.close();
    return port;
  },
  catch: (cause) => new NetFailure({ problem: `finding a free UDP port: ${String(cause)}` }),
});

/** The relay binary `WISP_RELAY_BIN` names, else the one cargo builds from relay/ (wisp:docs/relay.md). */
const relayBinary = Effect.gen(function*() {
  const named = process.env["WISP_RELAY_BIN"];
  if (named !== undefined) return named;
  if (!(yield* Effect.promise(() => Bun.file(join(relayDirectory, "Cargo.toml")).exists()))) {
    return yield* new NetFailure({ problem: `no relay source at ${relayDirectory}; set WISP_RELAY_BIN to a built relay` });
  }
  const build = yield* collect(ChildProcess.make("cargo", ["build", "--release", "-p", "relay"], { cwd: relayDirectory, stdin: "ignore" })).pipe(
    Effect.mapError((cause) => new NetFailure({ problem: `cargo build -p relay: ${String(cause)}` })),
  );
  if (build.exitCode !== 0) return yield* new NetFailure({ problem: `cargo build -p relay failed: ${build.stderr}` });
  return join(relayDirectory, "target/release/relay");
});

/** A relay on a free loopback port for this scope's length: the room kind a standalone match of up to four humans meets in. */
export const startLocalRelay = Effect.gen(function*() {
  const binary = yield* relayBinary;
  const port = yield* freePort;
  yield* ChildProcess.make(binary, ["--bind", `127.0.0.1:${port}`], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).pipe(
    Effect.mapError((cause) => new NetFailure({ problem: `starting the relay ${binary}: ${String(cause)}` })),
  );
  return { address: "127.0.0.1", port } satisfies Endpoint;
});
