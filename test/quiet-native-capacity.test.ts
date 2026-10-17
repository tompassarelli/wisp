import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { quietNativeSessionArgs, withQuietNativeCapacity } from "../scripts/wisp/client/quietNativeCapacity";

test("native evidence leases request quiet capacity while keeping a live native session [k2 property]", () => {
  const args = quietNativeSessionArgs("/capacity.mjs", "wisp-accept-pair-0");
  expect(args).toContain("--quiet");
  expect(args.slice(0, 11)).toEqual(["/capacity.mjs", "session", "--class", "native", "--new-clients", "0", "--quiet", "--memory-gib", "1", "--owner", "wisp-accept-pair-0"]);
  expect(args.at(-2)).toBe("-e");
});

test("native evidence starts after RESERVED on stderr and releases its lease when the run ends [k5 boundary]", async () => {
  const folder = mkdtempSync(join(tmpdir(), "wisp-quiet-capacity-test-"));
  const helper = join(folder, "machine-capacity.mjs");
  const ran = join(folder, "ran");
  const released = join(folder, "released");
  const previous = process.env["WISP_CAPACITY_HELPER"];
  writeFileSync(helper, [
    `const args = process.argv.slice(2);`,
    `if (!["session", "--class", "native", "--quiet", "--memory-gib", "1", "--owner", "wisp-standin-pair-0"].every(value => args.includes(value))) process.exit(2);`,
    `console.error(JSON.stringify({ decision: "RESERVED" }));`,
    `process.on("SIGTERM", async () => { await Bun.write(${JSON.stringify(released)}, "released"); process.exit(0); });`,
    `setInterval(() => {}, 1000);`,
  ].join("\n"));
  process.env["WISP_CAPACITY_HELPER"] = helper;
  try {
    await Effect.runPromise(withQuietNativeCapacity("wisp-standin-pair-0", Effect.sync(() => writeFileSync(ran, "ran"))).pipe(Effect.timeout("3 seconds")));
    expect(readFileSync(ran, "utf8")).toBe("ran");
    expect(readFileSync(released, "utf8")).toBe("released");
  } finally {
    if (previous === undefined) delete process.env["WISP_CAPACITY_HELPER"];
    else process.env["WISP_CAPACITY_HELPER"] = previous;
    rmSync(folder, { recursive: true, force: true });
  }
});
