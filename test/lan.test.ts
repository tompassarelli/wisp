import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientRun, idleness } from "../host/lan/pool";

describe("pool operability", () => {
  test("[integration filesystem] a client whose Warcraft III wrote a crash report since its launch stops reporting its pid, and a crash from before the launch leaves a running client running", () => {
    const documents = mkdtempSync(join(tmpdir(), "wisp-lan-crash-"));
    try {
      const launched = Date.now();
      expect(clientRun(4242, documents, launched)).toEqual({ pid: 4242 });
      mkdirSync(join(documents, "Errors/2026-10-26 16.06.33 d4247d40"), { recursive: true });
      writeFileSync(join(documents, "Errors/2026-10-26 16.06.33 d4247d40/Crash.txt"), "ACCESS_VIOLATION\n");
      utimesSync(join(documents, "Errors/2026-10-26 16.06.33 d4247d40/Crash.txt"), (launched - 60_000) / 1000, (launched - 60_000) / 1000);
      expect(clientRun(4242, documents, launched)).toEqual({ pid: 4242 });
      expect(clientRun(undefined, documents, launched)).toEqual({});
      mkdirSync(join(documents, "Errors/2026-10-26 16.19.29 a1bf8290"), { recursive: true });
      writeFileSync(join(documents, "Errors/2026-10-26 16.19.29 a1bf8290/Crash.txt"), "ACCESS_VIOLATION\n");
      utimesSync(join(documents, "Errors/2026-10-26 16.19.29 a1bf8290/Crash.txt"), (launched + 30_000) / 1000, (launched + 30_000) / 1000);
      expect(clientRun(4242, documents, launched)).toEqual({ crash: "Errors/2026-10-26 16.19.29 a1bf8290" });
      expect(idleness(new Date(launched).toISOString(), undefined, undefined, false, clientRun(4242, documents, launched).pid === undefined ? ["lan0a"] : [], launched).state).toBe("dead");
    } finally {
      rmSync(documents, { recursive: true, force: true });
    }
  });
});

describe("setup without reflinks", () => {
});

describe("host, replaying two recorded offline clients", () => {
});
