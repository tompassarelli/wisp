import { expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";
import { type LaunchRequest, admittedRunner, launchCommand } from "../host/play/linuxLaunch";
import { clientAdmitted } from "../host/lan/admission";

test("a client launch waits in the capacity helper's queue for its admission, then exits within its own limit", async () => {
  const request: LaunchRequest = {
    bun: "bun", capacity: "capacity.mjs", client: "pair-0-a", env: "env", nsenter: "nsenter", wine: "/wine", proton: false,
    launcher: { pid: 4242, cwd: "/home/tester", env: {} }, host: {},
  };
  const { command } = launchCommand(request);
  expect(command.slice(command.indexOf("capacity.mjs"), command.indexOf("capacity.mjs") + 6)).toEqual(["capacity.mjs", "session", "--class", "native", "--wait-seconds", "1800"]);

  const said: string[] = [];
  const helper = (after: string) => ChildProcess.make("bash", ["-c", `echo '{"decision":"QUEUED","reason":"DEFER_GPU_BUSY"}' >&2; sleep 1.5; echo '{"decision":"RESERVED","reason":"RUN"}' >&2; ${after}`], { stdout: "ignore" });
  const run = (after: string) => Effect.runPromise(Effect.flatMap(admittedRunner, (admitted) => admitted(helper(after), {
    admission: "10 seconds", exit: "1 second", waiting: (reason) => Effect.sync(() => said.push(reason)),
  })).pipe(Effect.provide(BunServices.layer)));
  expect(await run("exit 0")).toEqual({ kind: "exited", exitCode: 0, stderr: '{"decision":"QUEUED","reason":"DEFER_GPU_BUSY"}\n{"decision":"RESERVED","reason":"RUN"}' });
  expect(said).toEqual(["DEFER_GPU_BUSY"]);
  expect(await run("sleep 5")).toEqual({ kind: "running" });
});

test("a client launch whose helper leaves a child holding stderr still returns once the helper exits", async () => {
  const helper = ChildProcess.make("bash", ["-c", `echo '{"decision":"RESERVED","reason":"RUN"}' >&2; sleep 20 & exit 0`], { stdout: "ignore" });
  const started = Date.now();
  const launched = await Effect.runPromise(Effect.flatMap(admittedRunner, (admitted) => admitted(helper, {
    admission: "10 seconds", exit: "10 seconds", waiting: () => Effect.void,
  })).pipe(Effect.provide(BunServices.layer)));
  expect({ launched, quick: Date.now() - started < 5000 }).toEqual({ launched: { kind: "exited", exitCode: 0, stderr: '{"decision":"RESERVED","reason":"RUN"}' }, quick: true });
});

test("[scenario] a pool client's launch counts as started only once the capacity helper admits it, saying why it waits, and a launch that exits in the queue is not admitted", async () => {
  const errFile = join(mkdtempSync(join(tmpdir(), "wisp-client-admission-")), "lan0a.err");
  writeFileSync(errFile, `${JSON.stringify({ decision: "QUEUED", reason: "DEFER_GPU_CLIENTS" })}\n`);
  const said: string[] = [];
  const started = Date.now();
  setTimeout(() => appendFileSync(errFile, `${JSON.stringify({ decision: "RESERVED", reason: "RUN", lease: "78240051-3e84-4571-bee7-c0f6a2e36bd5" })}\n`), 2500);
  expect(await Effect.runPromise(clientAdmitted("lan0a", errFile, Effect.succeed(true), (line) => said.push(line)))).toBe(true);
  expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
  expect(said).toEqual(["lan0a: waiting in the capacity helper's queue (DEFER_GPU_CLIENTS)"]);
  writeFileSync(errFile, `${JSON.stringify({ decision: "QUEUED", reason: "DEFER_QUEUED" })}\n`);
  expect(await Effect.runPromise(clientAdmitted("lan0a", errFile, Effect.succeed(false), () => undefined))).toBe(false);
});
