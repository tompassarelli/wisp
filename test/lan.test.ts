import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { isActionLog, parseActionLog } from "../scripts/wisp/lan/actionLog";
import { startHost } from "../scripts/wisp/lan/host";
import type { MapFacts } from "../scripts/wisp/lan/map";
import { interfaces } from "../scripts/platform/linux/procfs";
import {
  PACKET, Reader, Writer, decodeIncomingAction, encodePacket, decodeOutgoingAction, decodeSlotTable, decodeStatString, encodeGameSettings, encodeSlotTable,
  encodeStatString, incomingAction, outgoingAction, splitPackets,
} from "../scripts/wisp/lan/w3gs";

describe("offline check", () => {
  test("[spec docs/lan.md] only loopback counts as offline", () => {
    const netDev = "Inter-|   Receive\n face |bytes\n    lo: 1 2 3\n";
    expect(interfaces(netDev)).toEqual(["lo"]);
    expect(interfaces(`${netDev}  eth0: 4 5 6\n`)).toEqual(["lo", "eth0"]);
  });
});

describe("W3GS", () => {
  test("[invariant] packets split at their lengths and keep a partial one for the next read", () => {
    const one = outgoingAction(Uint8Array.of(0x61));
    const joined = new Uint8Array([...one, ...one.subarray(0, 3)]);
    const { packets, rest } = splitPackets(joined);
    expect(packets.map(({ type }) => type)).toEqual([PACKET.OutgoingAction]);
    expect(decodeOutgoingAction(packets[0]?.payload ?? new Uint8Array())).toEqual(Uint8Array.of(0x61));
    expect(rest).toEqual(one.subarray(0, 3));
  });

  test("[invariant] an OutgoingAction with a wrong CRC32 is refused", () => {
    const packet = outgoingAction(Uint8Array.of(0x61));
    packet[4] = (packet[4] ?? 0) ^ 1;
    expect(() => decodeOutgoingAction(packet.subarray(4))).toThrow(/CRC32/);
  });

  test("[invariant] a turn round-trips with its CRC16; an empty turn is only its milliseconds", () => {
    const actions = [{ playerId: 1, data: Uint8Array.of(0x61) }, { playerId: 2, data: Uint8Array.of(0x77, 0x41, 0, 0x42, 0, 0, 0, 0, 0) }];
    const packet = incomingAction(30, actions);
    expect(decodeIncomingAction(packet.subarray(4))).toEqual({ milliseconds: 30, actions });
    expect(incomingAction(30, [])).toEqual(Uint8Array.of(0xf7, 0x0c, 6, 0, 30, 0));
  });

  test("[invariant] the stat string encoding round-trips and never contains a zero", () => {
    const source = Uint8Array.from({ length: 50 }, (_, index) => (index * 37) & 0xff);
    const encoded = encodeStatString(source);
    expect(encoded.includes(0)).toBe(false);
    expect(decodeStatString(encoded)).toEqual(source);
    const settings = encodeGameSettings({ flags: 2, width: 52, height: 52, xoro: 0xce3bb7b3, path: "Maps\\x.w3x", hostName: "Wisp", sha1: new Uint8Array(20) });
    expect(settings.at(-1)).toBe(0);
    const plain = new Reader(decodeStatString(settings.subarray(0, -1)));
    expect([plain.u32(), plain.u8(), plain.u16(), plain.u16(), plain.u32(), plain.cstring(), plain.cstring()]).toEqual([2, 0, 52, 52, 0xce3bb7b3, "Maps\\x.w3x", "Wisp"]);
  });

  test("[invariant] a slot table round-trips", () => {
    const table = { slots: [{ playerId: 1, download: 100, status: 2, computer: false, team: 0, color: 0, race: 0x60, computerType: 1, handicap: 100 }], randomSeed: 7, layout: 1, players: 4 };
    expect(decodeSlotTable(new Reader(encodeSlotTable(new Writer(), table).bytes()))).toEqual(table);
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

    const deadline = performance.now() + 60_000;
    while (!done() && performance.now() < deadline) await Bun.sleep(5);
    if (!done()) throw new Error(`timed out waiting for ${what}`);
  };

  test("[native] joins, retires lobby discovery, loads, logs actions and flags a checksum that differs", async () => {
    const lines: string[] = [];
    let discoveryPort: number | undefined;
    let discoveryClosed = false;
    const announcements = await Bun.udpSocket({ hostname: "127.0.0.1", socket: {
      data: (_socket, _data, port) => { discoveryPort = port; },
      error: () => { discoveryClosed = true; announcements.close(); },
    } });
    const scope = await Effect.runPromise(Scope.make());
    const host = await Effect.runPromise(startHost({ map: MAP, gameName: "t", clients: ["lan0a", "lan0b"], turnMs: 5, countdownMs: 0, settleMs: 0, log: (line) => lines.push(line), announcePorts: [announcements.port] }).pipe(Scope.provide(scope)));
    try {
      await until(() => discoveryPort !== undefined, "a lobby announcement");
      const sockets = await Promise.all([0, 1].map(() => Bun.connect({ hostname: "127.0.0.1", port: host.port, socket: { data: () => {} } })));
      const send = (client: number, packet: Uint8Array) => sockets[client]?.write(packet);
      const kind = (packet: Uint8Array) => packet[1];

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

      send(0, encodePacket(PACKET.OutgoingKeepAlive, new Writer().u8(0).u32(1).bytes()));
      send(1, encodePacket(PACKET.OutgoingKeepAlive, new Writer().u8(0).u32(2).bytes()));
      await until(() => host.status().desyncs === 1, "the desync");
      expect(lines.find((line) => line.includes(" desync "))?.replace(/^\S+ /, "")).toBe("desync turn 100 lan0a=00000001 lan0b=00000002");
      for (const socket of sockets) socket.end();
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      if (!discoveryClosed) announcements.close();
    }
  });
});

describe("action log", () => {
  const actions = readFileSync(join(import.meta.dir, "fixtures/lan/actions.log"), "utf8");

  test("[native] parses turns, actions and marks", () => {
    const log = parseActionLog(actions);
    expect(isActionLog(actions)).toBe(true);
    expect(log.start).toBe(Date.parse("2026-10-07T02:51:29.433Z"));
    expect(log.actions.map(({ turn, client, kind }) => `${turn} ${client} ${kind}`)).toEqual(["4170 lan0b key", "4468 lan0b chat", "4468 lan0b key"]);
  });

});
