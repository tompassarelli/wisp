import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";
import { pollFor, spawnLogged } from "../scripts/wisp/hostProcess";

test("[repro #62] a scoped child records its shutdown output before its readers stop", async () => {
  const folder = mkdtempSync(join(tmpdir(), "wisp-shutdown-output-"));
  const stdout = join(folder, "stdout");
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      yield* spawnLogged(ChildProcess.make(process.execPath, ["-e", 'process.on("SIGTERM", () => { console.log("released"); process.exit(0); }); console.log("ready"); setInterval(() => {}, 1000);'], { stdin: "ignore", forceKillAfter: "1 second" }), { stdout, stderr: join(folder, "stderr") });
      const ready = yield* pollFor(5, "5 millis", Effect.tryPromise({ try: () => Bun.file(stdout).text(), catch: String }).pipe(Effect.orElseSucceed(() => ""), Effect.map((text) => text.includes("ready") ? true : undefined)));
      expect(ready).toBe(true);
    })).pipe(Effect.provide(BunServices.layer)));
    expect(readFileSync(stdout, "utf8")).toBe("ready\nreleased\n");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
