import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { checkDummy } from "../scripts/wisp/lan/dummy";
import { LanFailure } from "../scripts/wisp/lan/join";

test("[repro #46] a refused native lobby saves its version and first failed step before any dummy joins", async () => {
  const output = mkdtempSync(join(tmpdir(), "wisp-dummy-46-"));
  try {
    const exit = await Effect.runPromiseExit(checkDummy({
      program: "/not-started", count: 20, output, nativeVersion: "3.0.1.24342", announcePorts: [],
      map: { path: "Maps\\Wisp\\probe.w3x", size: 1234, crc32: 0, sha1: new Uint8Array(20), xoro: 0, width: 52, height: 52, layout: 0, players: [0, 1].map((id) => ({ id, controller: 1, race: 1 })), forces: [3] },
      joinNative: () => Effect.fail(new LanFailure({ problem: "TCPN unavailable" })),
    }));
    expect(Exit.isFailure(exit)).toBe(true);
    const result = JSON.parse(readFileSync(join(output, "result.json"), "utf8"));
    expect(result).toMatchObject({ status: "failed", nativeVersion: "3.0.1.24342", completed: 0, failedStep: "native lobby join", runs: [] });
    expect(result.problem).toContain("TCPN unavailable");
    expect(result.setupMs).toBeGreaterThanOrEqual(0);
    expect(readFileSync(join(output, "packets.log"), "utf8")).toBe("");
  } finally {
    rmSync(output, { recursive: true });
  }
});
