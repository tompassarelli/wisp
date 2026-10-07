import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { type Client, capture } from "../scripts/warcraft/desktop";

const folder = mkdtempSync(join(tmpdir(), "wisp-capture-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

function client(name: string, source: string): Client {
  const tool = join(folder, name);
  writeFileSync(tool, `#!${process.execPath}\n${source}`);
  chmodSync(tool, 0o755);
  return { name, documents: folder, tools: { grim: tool, xdotool: tool, wlrctl: tool, tesseract: tool }, x11: {}, wayland: {}, window: "42" };
}

test("framebuffer capture preserves binary pixel bytes", async () => {
  const frame = await Effect.runPromise(capture(client("pixels", 'process.stdout.write(Buffer.concat([Buffer.from("P6\\n1 1\\n255\\n"), Buffer.from([0, 128, 255])]));')));
  expect(frame.width).toBe(1);
  expect(frame.height).toBe(1);
  expect([...frame.rgb]).toEqual([0, 128, 255]);
});

test("cancelling a stalled framebuffer read stops and reaps its exact child", async () => {
  const pidFile = join(folder, "pid");
  const pending = capture(client("stalled", `await Bun.write(${JSON.stringify(pidFile)}, String(process.pid)); await Bun.sleep(30000);`));
  const exit = await Effect.runPromiseExit(pending.pipe(Effect.timeout("200 millis")));
  expect(Exit.isFailure(exit)).toBe(true);
  expect(existsSync(pidFile)).toBe(true);
  const pid = Number(readFileSync(pidFile, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
});
