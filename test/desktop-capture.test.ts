import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { Effect } from "effect";
import { linuxDesktopLayer } from "../scripts/platform/linux/desktop";
import { type Client, capture, captureTimed } from "../scripts/warcraft/desktop";

const folder = mkdtempSync(join(tmpdir(), "wisp-capture-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

function client(name: string, source: string): Client {
  const tool = join(folder, name);
  writeFileSync(tool, `#!${process.execPath}\n${source}`);
  chmodSync(tool, 0o755);
  return { name, documents: folder, tools: { grim: tool, xdotool: tool, wlrctl: tool, tesseract: tool }, x11: {}, wayland: {}, window: "42" };
}

test("[invariant] timed capture keeps binary pixel bytes and brackets the framebuffer producer on the supplied stimulus clock", async () => {
  const stamped = join(folder, "producer-stamp");
  const result = await Effect.runPromise(captureTimed(client("timed", `await Bun.sleep(20); await Bun.write(${JSON.stringify(stamped)}, String(Date.now())); process.stdout.write(Buffer.concat([Buffer.from("P6\\n1 1\\n255\\n"), Buffer.from([0, 128, 255])]));`), () => Date.now() * 1_000_000).pipe(Effect.provide(linuxDesktopLayer)));
  const producerNs = Number(readFileSync(stamped, "utf8")) * 1_000_000;
  expect(result.beforeNs).toBeLessThanOrEqual(producerNs);
  expect(result.afterNs).toBeGreaterThanOrEqual(producerNs);
  expect(result.afterNs - result.beforeNs).toBeGreaterThanOrEqual(20_000_000);
  expect([...result.frame.rgb]).toEqual([0, 128, 255]);
});
