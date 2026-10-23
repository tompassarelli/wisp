import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { stopGame } from "../host/lan/pool";

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

  test("[spec docs/lan.md] a client that exits on SIGTERM is not sent SIGKILL", async () => {
    const child = Bun.spawn(["sleep", "30"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    const log: string[] = [];
    await Effect.runPromise(stopGame({
      terminate: Effect.sync(() => { child.kill("SIGTERM"); }),
      survivors: Effect.sync(() => (child.exitCode === null && child.signalCode === null ? [child.pid] : [])),
      kill: () => Effect.sync(() => { log.push("kill"); }),
      outlived: () => Effect.sync(() => { log.push("outlived"); }),
      grace: "5 seconds",
    }));
    expect(log).toEqual([]);
  });
});
