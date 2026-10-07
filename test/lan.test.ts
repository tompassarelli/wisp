import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { alignBirths, headerStart, isActionLog, parseActionLog, turnAt } from "../scripts/wisp/engine/actionLog";
import { parsePresenceLog } from "../scripts/wisp/engine/presenceLog";
import { startHost } from "../scripts/wisp/lan/host";
import type { MapFacts } from "../scripts/wisp/lan/map";
import { decodeActions } from "../scripts/wisp/lan/actions";
import { mapXoro, pathInGame, xoroUpdate } from "../scripts/wisp/lan/map";
import { interfaces } from "../scripts/wisp/lan/offline";
import { FACTORY, LOOP, SELECTOR_OPERAND, TCPN, fileMappings, findAll, pattern, providerName, scanCode, selectorOperands, stoppedPc, writeTarget } from "../scripts/wisp/lan/provider";
import {
  PACKET, Reader, Writer, decodeIncomingAction, encodePacket, decodeOutgoingAction, decodeReqJoin, decodeSlotTable, decodeStatString, encodeGameSettings, encodeSlotTable,
  encodeStatString, incomingAction, outgoingAction, splitPackets,
} from "../scripts/wisp/lan/w3gs";

// The selector as 3.0.0.24268's running code has it, with the call targets
// and lea offset made up (wc3-slop-lan docs/porting.md §2.1).
const SELECTOR_BYTES = [0x48, 0x83, 0xec, 0x58, 0xe8, 1, 2, 3, 4, 0xb9, 0x50, 0x4f, 0x4f, 0x4c, 0xe8, 5, 6, 7, 8, 0xe8, 9, 9, 9, 9, 0x48, 0x8d, 0x0d, 1, 1, 1, 1, 0x48, 0xc7, 0x44, 0x24, 0x28, 4, 0, 0, 0];
const FACTORY_BYTES = [0x81, 0xfb, 0x54, 0x45, 0x4e, 0x42, 0x74, 0x3a, 0x81, 0xfb, 0x50, 0x4f, 0x4f, 0x4c, 0x74, 0x1f, 0x81, 0xfb, 0x4e, 0x50, 0x43, 0x54, 0x0f, 0x85, 0x9b, 0, 0, 0];

describe("provider switch", () => {
  test("finds the one selector and reads what it selects", () => {
    const code = Uint8Array.from([0x90, 0x90, ...SELECTOR_BYTES, 0xcc]);
    expect(selectorOperands(code)).toEqual([{ at: 2 + SELECTOR_OPERAND, operand: LOOP }]);
    code.set(TCPN, 2 + SELECTOR_OPERAND);
    expect(selectorOperands(code).map(({ operand }) => providerName(operand))).toEqual(["TCPN"]);
    code[2 + SELECTOR_OPERAND] = 0x41;
    expect(selectorOperands(code)).toEqual([]);
  });

  test("scans spans at their addresses, with the factory as evidence of TCPN support", () => {
    const found = scanCode([{ start: 0x1000, bytes: Buffer.from(SELECTOR_BYTES) }, { start: 0x9000, bytes: Buffer.from(FACTORY_BYTES) }]);
    expect(found.selectors.map(({ address }) => address)).toEqual([0x1000 + SELECTOR_OPERAND]);
    expect(found.factories).toEqual([0x9000]);
    expect(findAll(Uint8Array.from(FACTORY_BYTES), FACTORY)).toEqual([0]);
  });

  test("patterns take two-digit hex bytes and ?? wildcards only", () => {
    expect(pattern("48 ?? 0D")).toEqual([0x48, undefined, 0x0d]);
    expect(() => pattern("4")).toThrow();
  });

  test("provider ids read as the game spells them", () => {
    expect(providerName(LOOP)).toBe("LOOP");
    expect(providerName(TCPN)).toBe("TCPN");
  });

  test("a stopped thread's pc comes from /proc/PID/task/TID/syscall", () => {
    expect(stoppedPc("-1 0x7ffd0000 0x6ffff080bcaa\n")).toBe(0x6ffff080bcaa);
    expect(stoppedPc("202 0x1 0x2 0x0 0x0 0x0 0x0 0x7ffd0000 0x7f00001234\n")).toBe(0x7f00001234);
    expect(stoppedPc("running\n")).toBeUndefined();
  });

  test("a private mapping is written through /proc/PID/mem", () => {
    const maps = fileMappings("7f0000000000-7f0000001000 r-xp 00002000 00:01 99 /lib/x.so\n");
    expect(writeTarget(42, maps, 0x7f0000000010)).toEqual({ file: "/proc/42/mem", position: 0x7f0000000010 });
  });

  test("a shared mapping is written through the process's own descriptor for its file, at the file offset", () => {
    // This process holds no descriptor for inode 1, so the lookup must refuse rather than fall back to /proc/PID/mem.
    const maps = fileMappings(`6ffff080b000-6ffff080c000 r-xs 0118b000 00:01 1 /memfd:wine-mapping (deleted)\n`);
    expect(() => writeTarget(process.pid, maps, 0x6ffff080bcaa)).toThrow(/holds no descriptor/);
  });

  test("only loopback counts as offline", () => {
    const netDev = "Inter-|   Receive\n face |bytes\n    lo: 1 2 3\n";
    expect(interfaces(netDev)).toEqual(["lo"]);
    expect(interfaces(`${netDev}  eth0: 4 5 6\n`)).toEqual(["lo", "eth0"]);
  });
});

describe("W3GS", () => {
  test("packets split at their lengths and keep a partial one for the next read", () => {
    const one = outgoingAction(Uint8Array.of(0x61));
    const joined = new Uint8Array([...one, ...one.subarray(0, 3)]);
    const { packets, rest } = splitPackets(joined);
    expect(packets.map(({ type }) => type)).toEqual([PACKET.OutgoingAction]);
    expect(decodeOutgoingAction(packets[0]?.payload ?? new Uint8Array())).toEqual(Uint8Array.of(0x61));
    expect(rest).toEqual(one.subarray(0, 3));
  });

  test("an OutgoingAction with a wrong CRC32 is refused", () => {
    const packet = outgoingAction(Uint8Array.of(0x61));
    packet[4] = (packet[4] ?? 0) ^ 1;
    expect(() => decodeOutgoingAction(packet.subarray(4))).toThrow(/CRC32/);
  });

  test("a turn round-trips with its CRC16; an empty turn is only its milliseconds", () => {
    const actions = [{ playerId: 1, data: Uint8Array.of(0x61) }, { playerId: 2, data: Uint8Array.of(0x77, 0x41, 0, 0x42, 0, 0, 0, 0, 0) }];
    const packet = incomingAction(30, actions);
    expect(decodeIncomingAction(packet.subarray(4))).toEqual({ milliseconds: 30, actions });
    expect(incomingAction(30, [])).toEqual(Uint8Array.of(0xf7, 0x0c, 6, 0, 30, 0));
  });

  test("the stat string encoding round-trips and never contains a zero", () => {
    const source = Uint8Array.from({ length: 50 }, (_, index) => (index * 37) & 0xff);
    const encoded = encodeStatString(source);
    expect(encoded.includes(0)).toBe(false);
    expect(decodeStatString(encoded)).toEqual(source);
    const settings = encodeGameSettings({ flags: 2, width: 52, height: 52, xoro: 0xce3bb7b3, path: "Maps\\x.w3x", hostName: "Wisp", sha1: new Uint8Array(20) });
    expect(settings.at(-1)).toBe(0);
    const plain = new Reader(decodeStatString(settings.subarray(0, -1)));
    expect([plain.u32(), plain.u8(), plain.u16(), plain.u16(), plain.u32(), plain.cstring(), plain.cstring()]).toEqual([2, 0, 52, 52, 0xce3bb7b3, "Maps\\x.w3x", "Wisp"]);
  });

  test("a slot table round-trips", () => {
    const table = { slots: [{ playerId: 1, download: 100, status: 2, computer: false, team: 0, color: 0, race: 0x60, computerType: 1, handicap: 100 }], randomSeed: 7, layout: 1, players: 4 };
    expect(decodeSlotTable(new Reader(encodeSlotTable(new Writer(), table).bytes()))).toEqual(table);
  });

  test("ReqJoin reads the name an offline client joins with", () => {
    const payload = new Writer().u32(1).u32(0).u8(0).u16(16000).u32(1).cstring("").u8(2).u8(0).u8(0).raw(new Array(16).fill(0)).bytes();
    expect(decodeReqJoin(payload)).toMatchObject({ hostCounter: 1, listenPort: 16000, name: "" });
  });
});

describe("action decoding", () => {
  test("BlzSendSyncData is 0x77: prefix, data, a zero word", () => {
    const block = new Writer().u8(0x77).cstring("SC_GP").cstring("abc").u32(0).bytes();
    expect(decodeActions(block)).toEqual([{ kind: "sync", text: 'prefix="SC_GP" bytes=3 data="abc"', sync: { prefix: "SC_GP", data: "abc" } }]);
  });

  test("several actions in one block, orders with their order id", () => {
    const block = new Writer().u8(0x16).u8(1).u16(1).u32(0x10).u32(0x20).u8(0x11).u16(0x40).u32(0x000d0012).u32(0x10).u32(0x20).f32(128).f32(-64).bytes();
    expect(decodeActions(block).map(({ kind, text }) => `${kind} ${text}`)).toEqual(["select mode=1 units=10:20", "order flags=0x40 order=0xd0012 unit=10:20 at=128.0,-64.0"]);
  });

  test("an unknown id ends the block as raw bytes", () => {
    expect(decodeActions(Uint8Array.of(0x61, 0xee, 1, 2))).toEqual([{ kind: "escape", text: "" }, { kind: "raw", text: "id=0xee bytes=ee0102" }]);
  });
});

describe("map facts", () => {
  test("xoro folds each checked file's own checksum in after the script", () => {
    const script = Uint8Array.of(1, 0, 0, 0, 2);
    const w3e = Uint8Array.of(9, 9, 9, 9);
    const rotate = (v: number) => ((v << 3) | (v >>> 29)) >>> 0;
    expect(xoroUpdate(0, script)).toBe(rotate(rotate(1) ^ 2));
    const entries: Record<string, Uint8Array> = { "war3map.lua": script, "war3map.w3e": w3e };
    expect(mapXoro((name) => entries[name])).toBe(rotate(xoroUpdate(0, script) ^ xoroUpdate(0, w3e)));
    expect(() => mapXoro(() => undefined)).toThrow(/no war3map/);
  });

  test("the game names a map by its path below Maps", () => {
    expect(pathInGame("/x/Documents/Warcraft III/Maps/Smashcraft/a b.w3x")).toBe("Maps\\Smashcraft\\a b.w3x");
    expect(() => pathInGame("/tmp/a.w3x")).toThrow();
  });
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
    for (let tries = 0; tries < 400 && !done(); tries++) await Bun.sleep(5);
    if (!done()) throw new Error(`timed out waiting for ${what}`);
  };

  test("joins, retires lobby discovery, loads, logs actions and flags a checksum that differs", async () => {
    const lines: string[] = [];
    const steps: number[] = [];
    let discoveryPort: number | undefined;
    let discoveryClosed = false;
    const announcements = await Bun.udpSocket({ hostname: "127.0.0.1", socket: {
      data: (_socket, _data, port) => { discoveryPort = port; },
      error: () => { discoveryClosed = true; announcements.close(); },
    } });
    const host = startHost({ map: MAP, gameName: "t", clients: ["lan0a", "lan0b"], turnMs: 5, countdownMs: 0, settleMs: 0, log: (line) => lines.push(line), announcePorts: [announcements.port], onPacket: (direction, client, packet) => {
      if (direction === "out" && client === "lan0a" && packet[1] === PACKET.IncomingAction) steps.push(decodeIncomingAction(packet.subarray(4)).milliseconds);
    } });
    try {
      await until(() => discoveryPort !== undefined, "a lobby announcement");
      const sockets = await Promise.all([0, 1].map(() => Bun.connect({ hostname: "127.0.0.1", port: host.port, socket: { data: () => {} } })));
      const send = (client: number, packet: Uint8Array) => sockets[client]?.write(packet);
      const kind = (packet: Uint8Array) => packet[1];
      // Lobby: joins, map sizes, profile echoes; then loading.
      for (const { client, packet } of fixture.filter(({ packet }) => kind(packet) !== PACKET.GameLoadedSelf && kind(packet) !== PACKET.OutgoingAction && kind(packet) !== PACKET.OutgoingKeepAlive && kind(packet) !== PACKET.ChatToHost)) {
        send(client, packet);
        if (kind(packet) === PACKET.ReqJoin) await until(() => host.status().players.filter(({ connected }) => connected).length === client + 1, "a join");
      }
      await until(() => host.status().phase === "loading", "loading");
      for (const { client, packet } of fixture.filter(({ packet }) => kind(packet) === PACKET.GameLoadedSelf)) send(client, packet);
      await until(() => host.status().phase === "playing", "the game");
      if (discoveryPort === undefined) throw new Error("no lobby discovery port");
      announcements.send("closed?", discoveryPort, "127.0.0.1");
      await until(() => discoveryClosed, "the retired discovery socket");
      expect(discoveryClosed).toBe(true);
      // The game: every recorded action and chat, then each client's keepalives, which agree.
      for (const { client, packet } of fixture.filter(({ packet }) => kind(packet) === PACKET.OutgoingAction || kind(packet) === PACKET.ChatToHost)) send(client, packet);
      for (const { client, packet } of fixture.filter(({ packet }) => kind(packet) === PACKET.OutgoingKeepAlive)) send(client, packet);
      await until(() => lines.some((line) => / turn \d+ lan0b p2 chat /.test(line)) && host.status().players.every(({ checksums }) => checksums === 100), "the actions and keepalives");
      expect(host.status().desyncs).toBe(0);
      const logged = lines.filter((line) => / turn \d+ /.test(line)).map((line) => line.replace(/^\S+ turn \d+ /, ""));
      expect(logged).toEqual([
        'lan0a p1 sync prefix="SC_FE" bytes=0 data=""',
        'lan0b p2 sync prefix="SC_FE" bytes=0 data=""',
        "lan0b p2 key object=cbc:cbc event=525112 key=13 meta=0",
        'lan0b p2 chat trigger=10a3:10a3 text="-dev quick"',
        "lan0b p2 key object=cbe:cbe event=525113 key=13 meta=0",
      ]);
      expect(lines.some((line) => line.endsWith('chat lan0b p2 "-dev quick"'))).toBe(true);
      const beforeFast = steps.length;
      const gameBeforeFast = host.status().gameSeconds;
      host.setSpeed(4);
      await until(() => steps.length >= beforeFast + 10, "accelerated turns");
      expect(host.status().speed).toBe(4);
      expect(steps.slice(beforeFast).every(step => step === 5)).toBe(true);
      expect(host.status().gameSeconds - gameBeforeFast).toBeCloseTo((steps.length - beforeFast) * 0.005, 5);
      expect(host.status().desyncs).toBe(0);
      expect(() => host.setSpeed(NaN)).toThrow("between 1 and 16");
      host.setSpeed(1);
      expect(host.status().speed).toBe(1);
      // A keepalive whose checksum differs is a desync, named by its turn.
      send(0, encodePacket(PACKET.OutgoingKeepAlive, new Writer().u8(0).u32(1).bytes()));
      send(1, encodePacket(PACKET.OutgoingKeepAlive, new Writer().u8(0).u32(2).bytes()));
      await until(() => host.status().desyncs === 1, "the desync");
      expect(lines.find((line) => line.includes(" desync "))?.replace(/^\S+ /, "")).toBe("desync turn 100 lan0a=00000001 lan0b=00000002");
      for (const socket of sockets) socket.end();
    } finally {
      host.stop();
      if (!discoveryClosed) announcements.close();
    }
  });
});

describe("action log", () => {
  const actions = readFileSync(join(import.meta.dir, "fixtures/lan/actions.log"), "utf8");
  const poll = readFileSync(join(import.meta.dir, "fixtures/lan/lan0b.presence.log"), "utf8");

  test("parses turns, actions and marks", () => {
    const log = parseActionLog(actions);
    expect(isActionLog(actions)).toBe(true);
    expect(log.start).toBe(Date.parse("2026-10-07T02:51:29.433Z"));
    expect(log.actions.map(({ turn, client, kind }) => `${turn} ${client} ${kind}`)).toEqual(["4170 lan0b key", "4468 lan0b chat", "4468 lan0b key"]);
    expect(turnAt(log, 256.6, 30)).toBe(4469);
  });

  test("places each birth in its turn after the actions that led to it", () => {
    const lines = alignBirths(parseActionLog(actions), parsePresenceLog(poll), headerStart(poll) ?? 0, { turnMs: 30, limit: 2 });
    expect(lines).toEqual([
      '256.614 birth 4281 CAgentBaseAbs owner CPlayerChatMatchEventData in turn 4470; 2 turns after turn 4468: lan0b chat trigger=10a3:10a3 text="-dev quick"; lan0b key object=cbe:cbe event=525113 key=13 meta=0',
      '256.614 birth 4282 CAgentBaseAbs owner CTriggerExecution in turn 4470; 2 turns after turn 4468: lan0b chat trigger=10a3:10a3 text="-dev quick"; lan0b key object=cbe:cbe event=525113 key=13 meta=0',
    ]);
  });
});
