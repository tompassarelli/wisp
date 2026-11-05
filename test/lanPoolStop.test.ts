import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { CapacityAdmission } from "../host/contract/services";
import { stopGame } from "../host/lan/pool";
import { runPlatformSync } from "../host/os/platform/layer";

const hungClient = async () => {
  const child = Bun.spawn([process.execPath, "-e", `process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000);`], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  await child.stdout.getReader().read();
  return child;
};

describe("pool stop", () => {
  test("[spec docs/lan.md] stopping the pool ends a client session whose game ignores the stop, by SIGTERM and then SIGKILL after a grace period", async () => {
    const child = await hungClient();
    const log: string[] = [];
    const survivors = Effect.sync(() => (child.exitCode === null && child.signalCode === null ? [child.pid] : []));
    await Effect.runPromise(stopGame({
      terminate: Effect.sync(() => { child.kill("SIGTERM"); }),
      survivors,
      kill: (pids) => Effect.sync(() => { for (const pid of pids) process.kill(pid, "SIGKILL"); }),
      outlived: (pids) => Effect.sync(() => { log.push(`outlived ${pids.length}`); }),
      grace: "1 second",
    }));
    expect(await Promise.race([child.exited, Bun.sleep(5000).then(() => "still running")])).toBe(137);
    expect(log).toEqual(["outlived 1"]);
  });

  test.if(process.platform === "linux")("[boundary] a pool whose working directory was removed still reads a stopped client scope as gone", () => {
    const home = process.cwd();
    const gone = mkdtempSync(join(tmpdir(), "wisp-pool-cwd-"));
    process.chdir(gone);
    rmSync(gone, { recursive: true });
    try {
      const live = runPlatformSync(CapacityAdmission.use((admission) => admission.leaseLive(crypto.randomUUID()).pipe(Effect.result)));
      expect(live).toEqual(expect.objectContaining({ _tag: "Success", success: false }));
    } finally {
      process.chdir(home);
    }
  });
});
