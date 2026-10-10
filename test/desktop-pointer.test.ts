import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { afterAll, expect, test } from "bun:test";
import { type Client, clickInWindow, hover, windowPoint } from "../scripts/warcraft/desktop";

const folder = mkdtempSync(join(tmpdir(), "wisp-pointer-"));
const sent = join(folder, "sent");
const at = join(folder, "at");
const tool = join(folder, "tool");

writeFileSync(tool, `#!/bin/sh
echo "$*" >> "${sent}"
case "$1" in
  getwindowgeometry) printf 'WINDOW=42\\nX=100\\nY=50\\nWIDTH=800\\nHEIGHT=600\\n' ;;
  getmouselocation) read x y < "${at}"; printf 'X=%s\\nY=%s\\nSCREEN=0\\nWINDOW=42\\n' "$x" "$y" ;;
  mousemove_relative) read x y < "${at}"; echo "$((x + $3)) $((y + $4))" > "${at}" ;;
esac
`);
chmodSync(tool, 0o755);
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const client: Client = { name: "a", documents: "/not/a/prefix", tools: { grim: tool, xdotool: tool, wlrctl: tool, tesseract: tool }, x11: {}, wayland: {}, window: "42" };
const scenario = async (effect: Effect.Effect<void, unknown>) => {
  writeFileSync(sent, "");
  writeFileSync(at, "7 9\n");
  const exit = await Effect.runPromiseExit(effect);
  return { exit, lines: readFileSync(sent, "utf8").trim().split("\n"), at: readFileSync(at, "utf8").trim() };
};

test("[reference] hover X Y moves the pointer to the window pixel, offset by the window's origin, and presses nothing", async () => {
  const { exit, lines, at: pointer } = await scenario(hover(client, 320, 240));
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(lines).toContain("windowactivate --sync 42");
  expect(lines).toContain("mousemove_relative -- 413 281");
  expect(pointer).toBe("420 290");
  expect(lines.filter((line) => /mousedown|mouseup|key|type/.test(line))).toEqual([]);
});

test("[reference] click X Y moves to the same window pixel, then presses and releases button 1", async () => {
  const { exit, lines, at: pointer } = await scenario(clickInWindow(client, 320, 240));
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(pointer).toBe("420 290");
  expect(lines.slice(-2)).toEqual(["mousedown 1", "mouseup 1"]);
});

test("[reference] a pixel outside the window moves nothing", async () => {
  const { exit, lines } = await scenario(hover(client, 800, 10));
  expect(Exit.isFailure(exit)).toBe(true);
  expect(lines.filter((line) => line.startsWith("mouse"))).toEqual([]);
});

test("[invariant] windowPoint keeps every in-window pixel inside the window and refuses the rest", () => {
  const window = { x: 30, y: 20, width: 64, height: 48 };
  for (let x = -2; x < 68; x++) {
    for (let y = -2; y < 52; y++) {
      const point = windowPoint(window, x, y);
      const inside = x >= 0 && y >= 0 && x < 64 && y < 48;
      expect(point).toEqual(inside ? { x: 30 + x, y: 20 + y } : undefined);
    }
  }
  expect(windowPoint(window, 1.5, 2)).toBeUndefined();
});
