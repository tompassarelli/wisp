import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIntoStore, stepProblem } from "../scripts/wisp/ciMapBuild";

const checkout = join(import.meta.dir, "..");
const revision = "0123456789abcdef0123456789abcdef01234567";
const write = ["bash", "-c", 'printf map > "$WISP_MAP_OUT"'];

test("[spec #30] the map lands in the store as NAME-REVISION.w3x with its sha256 beside it", async () => {
  const store = join(mkdtempSync(join(tmpdir(), "wisp-ci-store-")), "maps");
  const stored = await buildIntoStore({ store, name: "sample", revision, command: write, checkout, env: { PATH: process.env.PATH } });
  expect(stored.map).toBe(join(store, `sample-${revision}.w3x`));
  expect(readFileSync(stored.map, "utf8")).toBe("map");
  const sha256 = new Bun.CryptoHasher("sha256").update("map").digest("hex");
  expect(readFileSync(stored.digestFile, "utf8")).toBe(`${sha256}  sample-${revision}.w3x\n`);
  expect(readdirSync(store).sort()).toEqual([`sample-${revision}.w3x`, `sample-${revision}.w3x.sha256`]);
});

test("[invariant] a failed build publishes nothing", async () => {
  const store = join(mkdtempSync(join(tmpdir(), "wisp-ci-store-")), "maps");
  await expect(buildIntoStore({ store, name: "sample", revision, command: ["bash", "-c", "exit 3"], checkout, env: { PATH: process.env.PATH } })).rejects.toThrow("exited 3");
  expect(readdirSync(store)).toEqual([]);
});

test("[spec #30] the step refuses a store in the checkout, a hosted runner and a name or revision it can't put in a file name", () => {
  const step = { store: "/srv/wisp-maps", name: "sample", revision, command: write, checkout, env: {} };
  expect(stepProblem(step)).toBeUndefined();
  expect(stepProblem({ ...step, store: join(checkout, "build/maps") })).toContain("inside the checkout");
  expect(stepProblem({ ...step, env: { RUNNER_ENVIRONMENT: "github-hosted" } })).toContain("self-hosted");
  expect(stepProblem({ ...step, name: "../x" })).toContain("map name");
  expect(stepProblem({ ...step, revision: "main" })).toContain("commit hash");
});
