import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { relayedStatus } from "../host/lan/relayedStatus";

const recorded = readFileSync(join(import.meta.dir, "fixtures/lan/relayed-relay.log"), "utf8");
const upTo = (marker: string) => recorded.slice(0, recorded.indexOf(marker) + marker.length);
const labels = ["lan0a", "lan0b"];

describe("relayed match status", () => {
  test("[scenario laptop pair 0, 2026-10-25] the relay's log of a 3.0.0.24268 relayed match reads as lobby, countdown, loading, playing and, once every slot has left, over, with each client's join, load and leave", () => {
    expect(relayedStatus("", labels)).toEqual({ phase: "lobby", players: labels.map((label) => ({ label, connected: false, loaded: false, left: false })) });
    const joined = relayedStatus(upTo("slot 0 Ready"), labels);
    expect(joined.phase).toBe("lobby");
    expect(joined.players.map(({ connected }) => connected)).toEqual([true, false]);
    expect(relayedStatus(upTo("phase Countdown"), labels).phase).toBe("countdown");
    const loading = relayedStatus(upTo("slot 0 Loaded"), labels);
    expect(loading.phase).toBe("loading");
    expect(loading.players.map(({ loaded }) => loaded)).toEqual([true, false]);
    expect(relayedStatus(recorded, labels)).toEqual({ phase: "playing", players: labels.map((label) => ({ label, connected: true, loaded: true, left: false })) });
    const oneLeft = relayedStatus(`${recorded}86.430 room 1d76136c3aaf2dba slot 1 Left(7)\n`, labels);
    expect(oneLeft.phase).toBe("playing");
    expect(oneLeft.players[1]).toEqual({ label: "lan0b", connected: false, loaded: true, left: true });
    expect(relayedStatus(`${recorded}86.430 room 1d76136c3aaf2dba slot 1 Left(7)\n86.434 room 1d76136c3aaf2dba slot 0 Left(7)\n`, labels).phase).toBe("over");
  });
});
