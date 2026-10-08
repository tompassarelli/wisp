// The verdict CI relies on (wisp:docs/ci.md): the sample's headless journey
// passes, and the same journey against a fixture whose clients diverge fails.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { farmTest } from "wisp/scripts/wisp/farmTest";

const sample = join(import.meta.dir, "..");
const run = (program: string) => Bun.spawnSync(["bun", program, "headless"], { cwd: join(sample, "../.."), stdout: "pipe", stderr: "pipe" });

farmTest("[invariant] the sample's journey passes and the desync fixture's fails", () => {
  expect(run(join(sample, "scripts/sample.ts")).exitCode).toBe(0);
  const broken = run(join(sample, "test/fixtures/desync-sample.ts"));
  expect(broken.exitCode).toBe(1);
  expect(`${broken.stdout}${broken.stderr}`).toMatch(/ping-reload: \d+ problems?/);
}, 30_000);
