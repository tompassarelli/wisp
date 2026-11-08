import { expect, test } from "bun:test";
import { join } from "node:path";
import { type Landing, type MainRun, triage } from "../host/checks/revertRed";
import { cargoInputs, scopeJob } from "../host/checks/jobInputs";
import { stalledMirrorOnly } from "../host/checks/mainRed";

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 31, 8, 5);
const run = (id: number, sha: string, conclusion: string, minutes: number, status = "completed"): MainRun => ({ id, sha, conclusion, status, finishedAt: T0 + minutes * MINUTE });
const landing = (sha: string, message = "Render compare (Fixes #7)", extra: Partial<Landing> = {}): Landing => ({ sha, message, parents: 1, files: ["host/a.ts"], ...extra });

const green = run(10, "a".repeat(40), "success", -30);
const bad = run(11, "b".repeat(40), "failure", 0);

test("[invariant] a landing that touches no path a failing cargo step builds is not reverted; one that reaches the crate, an include outside it, or a failing non-cargo step is watched", () => {
  const root = join(import.meta.dir, "..");
  const inputs = cargoInputs(root, "window");
  expect(inputs).toContain("window/");
  expect(inputs).toContain("test/fixtures/tone.ogg");
  const windowJob = (steps: string[]) => scopeJob({ name: "window", steps }, (crate) => cargoInputs(root, crate));
  const cargoTest = windowJob(["Run cargo test --release --locked"]);
  const previous = { ...green, ancestor: true };
  const frames = landing("601b2c7e".padEnd(40, "0"), "Share the frames constant", { files: ["src/game/frames.d.ts", "src/game/native/frames.ts", "src/game/warcraft/frames.ts"] });
  const base = { run: bad, previous, landed: 1, landing: frames, failed: [cargoTest] };
  const verdict = triage(base);
  expect(verdict.kind).toBe("none");
  expect(verdict.kind === "none" && verdict.why).toContain("failing job window (window/");

  expect(triage({ ...base, landing: { ...frames, files: ["window/wisp-window/src/render/assets.rs"] } })).toEqual({ kind: "watch" });
  expect(triage({ ...base, landing: { ...frames, files: ["test/fixtures/tone.ogg"] } })).toEqual({ kind: "watch" });
  expect(triage({ ...base, failed: [windowJob(["Headless probe on lavapipe"])] })).toEqual({ kind: "watch" });
  expect(triage({ ...base, failed: [cargoTest, scopeJob({ name: "framework", steps: ["Run bun run check"] }, () => [])] })).toEqual({ kind: "watch" });
});

test("[bug wisp#252] a run whose only failure is the apt-install stall opens no red issue and reverts nothing", () => {
  const stamp = "2026-11-07T23:50:00.0000000Z";
  const line = (step: string, text: string) => `framework\t${step}\t${stamp} ${text}`;
  const stalled = [
    line("Install the native archive test dependency", "##[warning]apt-get attempt 3 of 3 for libstorm-dev stalled or failed"),
    line("Install the native archive test dependency", "##[error]Process completed with exit code 75."),
  ].join("\n");
  const failedTest = [stalled, line("Run bun run test", "##[error]Process completed with exit code 1.")].join("\n");
  const timedOut = [stalled, line("Run bun run test", "##[error]The job has exceeded the maximum execution time of 18m0s")].join("\n");

  expect(stalledMirrorOnly(stalled)).toBe(true);
  expect(stalledMirrorOnly(failedTest)).toBe(false);
  expect(stalledMirrorOnly(timedOut)).toBe(false);
  expect(stalledMirrorOnly("")).toBe(false);

  const base = { run: bad, previous: { ...green, ancestor: true }, landed: 1, landing: landing("c".repeat(40)), failed: [{ name: "framework", inputs: undefined }] };
  expect(triage({ ...base, stalledMirror: stalledMirrorOnly(failedTest) })).toEqual({ kind: "watch" });
  const verdict = triage({ ...base, stalledMirror: stalledMirrorOnly(stalled) });
  expect(verdict.kind).toBe("none");
  expect(verdict.kind === "none" && verdict.why).toContain("stalled apt mirror");
});
