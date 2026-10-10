import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { startHost } from "../scripts/wisp/lan/host";
import type { MapFacts } from "../scripts/wisp/lan/map";
import { PACKET, Writer, encodePacket } from "../scripts/wisp/lan/w3gs";

describe("offline check", () => {

});

describe("W3GS", () => {

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

});
