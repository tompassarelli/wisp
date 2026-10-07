import { expect, test } from "bun:test";
import { poolProfile, preferences, PROFILES } from "../scripts/wisp/lan/pool";

test("a pool cap changes only foreground and background FPS in its preferences", () => {
  const base = preferences(poolProfile("parity"), 0).split("\n");
  const changed = preferences(poolProfile("parity", 40), 0).split("\n");
  expect(changed.filter((line, index) => line !== base[index])).toEqual(["backgroundmaxfps=40", "maxfps=40"]);
  expect(PROFILES["parity"]?.maxFps).toBe(60);
  expect(poolProfile("visual", 40).classic).toBe(false);
});

test("invalid frame caps fail before a pool client starts", () => {
  for (const fps of [0, -1, 1.5, Number.NaN, Infinity]) expect(() => poolProfile("parity", fps)).toThrow("--fps takes a positive whole number");
});
