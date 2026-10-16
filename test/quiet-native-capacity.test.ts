import { expect, test } from "bun:test";
import { quietNativeSessionArgs } from "../scripts/wisp/quietNativeCapacity";

test("native evidence leases request quiet capacity while keeping a live native session [k2 property]", () => {
  const args = quietNativeSessionArgs("/capacity.mjs", "wisp-accept-native");
  expect(args).toContain("--quiet");
  expect(args.slice(0, 9)).toEqual(["/capacity.mjs", "session", "--class", "native", "--quiet", "--memory-gib", "1", "--owner", "wisp-accept-native"]);
  expect(args.at(-2)).toBe("-e");
});
