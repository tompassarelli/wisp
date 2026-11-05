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
  test("[integration cp on tmpfs] clients copy everything outside Data and _retail_, share those two but for the game's shmem and the menu page, leave the source's menu page alone and relink a replaced file on refresh", async () => {
    const root = mkdtempSync("/dev/shm/wisp-lan-setup-");
    const dataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = join(root, "data");
    try {
      const from = join(root, "Warcraft III");
      const file = (path: string, text: string) => {
        mkdirSync(join(from, path, ".."), { recursive: true });
        writeFileSync(join(from, path), text);
      };
      file(".build.info", "Branch!STRING:0|Active!DEC:1|Version!STRING:0\nus|1|3.0.0.24268\n");
      file("_retail_/x86_64/Warcraft III.exe", "exe 1");
      file("_retail_/webui/index.html", menuPage(47123));
      file("Data/data/data.000", "archive 1");
      file("Data/data/shmem", "shared memory");
      const lines: string[] = [];
      const setup = (name: string) => {
        mkdirSync(join(installOf(name), ".."), { recursive: true });
        writeFileSync(join(prefixOf(name), "user.reg"), "\"Allow Local Files\"=dword:00000001\n");
        return Effect.runPromise(setupClient(name, from, "3.0.0.24268", 47200, (line) => lines.push(line)).pipe(
          Effect.provideService(GameLauncher, GameLauncher.of({ inPrefix: () => Effect.die("setup made a prefix") }))));
      };
      const filesOf = (name: string) => readdirSync(installOf(name), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
      await setup("lan0a");
      await setup("lan0b");
      for (const name of ["lan0a", "lan0b"]) {
        expect(statSync(join(installOf(name), "Data/data/data.000")).ino).toBe(statSync(join(from, "Data/data/data.000")).ino);
        expect(statSync(join(installOf(name), "Data/data/shmem")).nlink).toBe(1);
        expect(statSync(join(installOf(name), "_retail_/x86_64/Warcraft III.exe")).ino).toBe(statSync(join(from, "_retail_/x86_64/Warcraft III.exe")).ino);
        expect(filesOf(name).filter((path) => !path.includes("/Data/") && !path.includes("/x86_64/")).map((path) => [path, statSync(path).nlink])).toEqual(
          [".build.info", "_retail_/webui/index.html"].map((path) => [join(installOf(name), path), 1]).sort());
      }
      expect(readFileSync(join(from, "_retail_/webui/index.html"), "utf8")).toBe(menuPage(47123));
      file("_retail_/x86_64/Warcraft III.exe.next", "exe 22");
      renameSync(join(from, "_retail_/x86_64/Warcraft III.exe.next"), join(from, "_retail_/x86_64/Warcraft III.exe"));
      file("Data/data/data.000.next", "archive 2");
      renameSync(join(from, "Data/data/data.000.next"), join(from, "Data/data/data.000"));
      await setup("lan0a");
      expect(statSync(join(installOf("lan0a"), "Data/data/data.000")).ino).toBe(statSync(join(from, "Data/data/data.000")).ino);
      expect(readFileSync(join(installOf("lan0b"), "Data/data/data.000"), "utf8")).toBe("archive 1");
      expect(readFileSync(join(installOf("lan0a"), "_retail_/x86_64/Warcraft III.exe"), "utf8")).toBe("exe 22");
      expect(readFileSync(join(installOf("lan0b"), "_retail_/x86_64/Warcraft III.exe"), "utf8")).toBe("exe 1");
      expect(readFileSync(join(from, "_retail_/webui/index.html"), "utf8")).toBe(menuPage(47123));
      expect(lines.filter((line) => line.includes("install"))).toEqual([
        "lan0a: install copied 0 MB outside Data and _retail_ from " + from,
        "lan0b: install copied 0 MB outside Data and _retail_ from " + from,
        expect.stringMatching(/^lan0a: install refreshed, copied 0 MB outside Data and _retail_ \(executable was 5 bytes, .*now 6 bytes/),
      ]);
    } finally {
      if (dataHome === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = dataHome;
      rmSync(root, { recursive: true, force: true });
    }
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
    const host = await Effect.runPromise(startHost({ map: MAP, gameName: "t", clients: ["lan0a", "lan0b"], turnSteps: [5], countdownMs: 0, settleMs: 0, log: (line) => lines.push(line), announcePorts: [announcements.port] }).pipe(Scope.provide(scope)));
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
