import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { GameLauncher } from "../host/contract/services";
import { startHost } from "../host/lan/host";
import { clientRun, idleness, installOf, prefixOf } from "../host/lan/pool";
import { setupClient } from "../host/lan/setup";
import { menuPage } from "../host/lan/menus";
import { type MapFacts } from "../host/lan/map";
import { PACKET, Writer, encodePacket } from "../host/lan/w3gs";

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
  const fixture = readFileSync(join(import.meta.dir, "fixtures/lan/offline-pair.packets"), "utf8").split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [, , label = "", hex = ""] = line.split(" ");
      return { client: label === "#1" || label === "lan0a" ? 0 : 1, packet: Uint8Array.from(Buffer.from(hex, "hex")) };
    });
  const MAP: MapFacts = {
    path: "Maps\\Wisp\\bisect-588610b7.w3x", size: 77671714, crc32: 0, sha1: new Uint8Array(20), xoro: 0, width: 52, height: 52, layout: 1,
    players: [0, 1, 2, 3].map((id) => ({ id, controller: 1, race: 1 })), forces: [15],
  };
  const until = async (done: () => boolean, what: string) => {

    const deadline = performance.now() + 60_000;
    while (!done() && performance.now() < deadline) await Bun.sleep(5);
    if (!done()) throw new Error(`timed out waiting for ${what}`);
  };
});
