import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { startHost } from "../scripts/wisp/lan/host";
import { ALARM_AFTER_MS, driverVerdict, wrongUser } from "../scripts/wisp/lan/pool";
import { type MapFacts, mapCopies } from "../scripts/wisp/lan/map";
import { PACKET, Writer, encodePacket } from "../scripts/wisp/lan/w3gs";

describe("offline check", () => {

});

describe("pool operability", () => {
  test("a run as another user than the live pool's owner names the owner and the command to run instead", () => {
    const tom = { uid: 1000, user: "tom", home: "/home/tom", pool: "/home/tom/.local/state/wisp/lan/pool.json" };
    expect(wrongUser(0, [tom], ["bun", "/home/tom/game/scripts/game.ts", "lan", "fresh", "a b.w3x"])).toBe(
      "the running LAN pool (/home/tom/.local/state/wisp/lan/pool.json) belongs to tom (uid 1000), and its state and agent sockets live under that user's home and runtime directory; run it as that user: sudo -u tom env HOME=/home/tom XDG_RUNTIME_DIR=/run/user/1000 bun /home/tom/game/scripts/game.ts lan fresh 'a b.w3x'",
    );
    expect(wrongUser(1000, [tom], ["bun", "game.ts", "lan", "status"])).toBeUndefined();
    expect(wrongUser(0, [], ["bun", "game.ts", "lan", "pool"])).toBeUndefined();
  });

  test("a pair whose driver died is idle at once and raises its alarm after ten minutes", () => {
    const goneAt = "2026-10-11T10:00:00.000Z";
    expect(driverVerdict({ pid: 7, since: "2026-10-11T09:00:00.000Z" }, Date.parse(goneAt) + ALARM_AFTER_MS)).toEqual({ alarm: false });
    const gone = { pid: 7, since: "2026-10-11T09:00:00.000Z", goneAt };
    expect(driverVerdict(gone, Date.parse(goneAt) + ALARM_AFTER_MS - 1)).toEqual({ idle: `idle since ${goneAt}, driver gone`, alarm: false });
    expect(driverVerdict(gone, Date.parse(goneAt) + ALARM_AFTER_MS).alarm).toBe(true);
    expect(ALARM_AFTER_MS).toBe(600_000);
  });
});

describe("map copies", () => {
  test("a failed run leaves none of the maps it copied into the clients' Documents and keeps the files that were there", async () => {
    const root = mkdtempSync(join(tmpdir(), "wisp-map-copies-"));
    const [a, b] = [join(root, "a/Maps/Wisp"), join(root, "b/Maps/Wisp")];
    mkdirSync(a, { recursive: true });
    writeFileSync(join(a, "own.w3x"), "the player's map");
    writeFileSync(join(a, "second.w3x"), "the player's older copy");
    for (const name of ["first.w3x", "second.w3x"]) writeFileSync(join(root, name), name);
    const seen: string[][] = [];
    const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function*() {
      const copy = yield* mapCopies([a, b]);
      yield* copy(join(root, "first.w3x"));
      yield* copy(join(root, "second.w3x"));
      seen.push(readdirSync(a).sort(), readdirSync(b).sort());
      return yield* Effect.fail("the match didn't start");
    })));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(seen).toEqual([["own.w3x", "second.w3x"], ["second.w3x"]]);
    expect([readdirSync(a).sort(), readdirSync(b)]).toEqual([["own.w3x", "second.w3x"], []]);
    expect(readFileSync(join(a, "own.w3x"), "utf8")).toBe("the player's map");
  });
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
      await until(() => lines.some((line) => / mark turn 64 /.test(line)), "two mark lines");
      const marks = lines.filter((line) => / mark turn /.test(line));
      for (const mark of marks) expect(mark).toMatch(/ mark turn \d+ game \d+\.\d{3} behind lan0a=-?\d+ lan0b=-?\d+$/);
      const logged = lines.filter((line) => /^\S+ turn \d+ /.test(line)).map((line) => line.replace(/^\S+ turn \d+ /, ""));
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
