import { expect, test } from "bun:test";
import { decodeActionRecords, decodeActions } from "../scripts/wisp/lan/actions";
import { compareReplayHost, type NativeReplay } from "../scripts/wisp/replayImport";

test("unknown and clipped actions retain the entire remaining payload at its byte offset", () => {
  const bytes = Buffer.from([0x02, 0xfe, 0x77, 0x00, 0x7f]);
  const records = decodeActionRecords(bytes);
  expect(records).toEqual([
    { kind: "resume", text: "", offset: 0, raw: "02" },
    { kind: "raw", text: "id=0xfe bytes=fe77007f", offset: 1, raw: "fe77007f" },
  ]);
  expect(records.map(record => record.raw).join("")).toBe(bytes.toString("hex"));
  expect(decodeActionRecords(Buffer.from([0x02, 0x77, 0x41]))[1]).toEqual({ kind: "raw", text: "id=0x77 bytes=7741", offset: 1, raw: "7741" });
  expect(decodeActions(bytes)).toEqual(records.map(({ raw, offset, ...action }) => action));
});

test("host comparison names missing, reordered, and changed payloads", () => {
  const raw = Buffer.from("7753435f47500049350000000000", "hex");
  const replay: NativeReplay = {
    format: "wisp-w3g-actions-1", engine: { gameIdentifier: "PX3W", version: 10200, buildNo: 7000, replayLengthMS: 30 },
    players: [], slots: [], map: { speed: 2, hideTerrain: false, mapExplored: false, alwaysVisible: false, default: true, observerMode: 0, teamsTogether: true, fixedTeams: true, fullSharedUnitControl: false, randomHero: false, randomRaces: false, referees: false, mapChecksum: "", mapChecksumSha1: "", mapName: "test", creator: "test" },
    turns: 1, timeMs: 30, records: [], commands: [{ turn: 0, timeMs: 30, playerId: 1, offset: 5, raw: raw.toString("hex"), actions: decodeActionRecords(raw) }],
  };
  const log = '# wisp lan host; seconds since 2026-10-07T00:00:00.000Z\n0.030 turn 0 test p1 sync prefix="SC_GP" bytes=2 data="I5"\n';
  expect(compareReplayHost(replay, log).differences).toEqual([]);
  expect(compareReplayHost(replay, log.replace('data="I5"', 'data="I4"')).differences).toHaveLength(1);
  expect(compareReplayHost(replay, log.replace("turn 0", "turn 1")).differences).toHaveLength(1);
  expect(compareReplayHost(replay, log.split("\n")[0] ?? "").differences).toEqual(["action count: host 0, replay 1"]);
});
