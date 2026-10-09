import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { type Client, capture, captureTimed } from "../scripts/warcraft/desktop";

const folder = mkdtempSync(join(tmpdir(), "wisp-capture-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

function client(name: string, source: string): Client {
  const tool = join(folder, name);
  writeFileSync(tool, `#!${process.execPath}\n${source}`);
  chmodSync(tool, 0o755);
  return { name, documents: folder, tools: { grim: tool, xdotool: tool, wlrctl: tool, tesseract: tool }, x11: {}, wayland: {}, window: "42" };
}

test("[invariant] framebuffer capture preserves binary pixel bytes", async () => {
  const frame = await Effect.runPromise(capture(client("pixels", 'process.stdout.write(Buffer.concat([Buffer.from("P6\\n1 1\\n255\\n"), Buffer.from([0, 128, 255])]));')));
  expect(frame.width).toBe(1);
  expect(frame.height).toBe(1);
  expect([...frame.rgb]).toEqual([0, 128, 255]);
});

test("[invariant] timed capture brackets the framebuffer producer on the supplied stimulus clock", async () => {
  const stamped = join(folder, "producer-stamp");
  const result = await Effect.runPromise(captureTimed(client("timed", `await Bun.sleep(20); await Bun.write(${JSON.stringify(stamped)}, String(Date.now())); process.stdout.write(Buffer.concat([Buffer.from("P6\\n1 1\\n255\\n"), Buffer.from([8, 16, 32])]));`), () => Date.now() * 1_000_000));
  const producerNs = Number(readFileSync(stamped, "utf8")) * 1_000_000;
  expect(result.beforeNs).toBeLessThanOrEqual(producerNs);
  expect(result.afterNs).toBeGreaterThanOrEqual(producerNs);
  expect(result.afterNs - result.beforeNs).toBeGreaterThanOrEqual(20_000_000);
  expect([...result.frame.rgb]).toEqual([8, 16, 32]);
});

test("[invariant] cancelling a stalled framebuffer read stops and reaps its exact child", async () => {
  const pidFile = join(folder, "pid");
  const pending = capture(client("stalled", `await Bun.write(${JSON.stringify(pidFile)}, String(process.pid)); await Bun.sleep(600000);`));

  const started = Effect.promise(async () => {
    while (!existsSync(pidFile) || readFileSync(pidFile, "utf8") === "") await Bun.sleep(10);
  });
  const exit = await Effect.runPromiseExit(pending.pipe(Effect.raceFirst(started.pipe(Effect.andThen(Effect.fail("started" as const))))));
  expect(Exit.isFailure(exit)).toBe(true);
  const pid = Number(readFileSync(pidFile, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
});
