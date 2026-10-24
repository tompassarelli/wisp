import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Cause, Effect, Exit, Scope } from "effect";
import { GameLauncher } from "../host/os/platform/services";
import { startHost } from "../host/lan/host";
import { ALARM_AFTER_MS, type Driver, driverVerdict, idleness, installOf, lanPlayRefusal, networkFlagProblem, pairClients, pairFlags, pairSides, prefixOf, wrongUser } from "../host/lan/pool";
import { setupClient } from "../host/lan/setup";
import { menuPage } from "../host/play/menus";
import { LanFailure } from "../host/lan/join";
import { type MapFacts, mapCopies, readMapFacts } from "../host/lan/map";
import { PACKET, Writer, encodePacket } from "../host/lan/w3gs";

describe("pool operability", () => {
  test("[reference POSIX sh] a run as another user than a live pool's owners is refused with a command that sh reads back as that owner's sudo and this exact command line", () => {
    const tom = { uid: 1000, user: "tom", home: "/home/tom", pool: "/home/tom/.local/state/wisp/lan/pool.json" };
    const ann = { uid: 1001, user: "ann", pool: "/home/ann/.local/state/wisp/lan/pool.json" };
    let seed = 1000;
    const next = (below: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed >>> 16) % below;
    };
    const letters = ["a", "Z", "0", " ", "'", "\"", "$", "`", "\\", "*", "~", "é", "\n", ";", "&", "|", "(", "#", "=", ":", "-", ".", "/", "@", "%", "+", ","];
    for (let sample = 0; sample < 60; sample++) {
      const command = ["bun", ...Array.from({ length: 1 + next(5) }, () => Array.from({ length: next(6) }, () => letters[next(letters.length)]).join(""))];
      const owners = next(2) === 0 ? [tom, ann] : [ann, tom];
      const [owner] = owners;
      const refusal = wrongUser(next(2) === 0 ? 0 : 1002, owners, command) ?? "";
      expect(refusal).toContain(`the running LAN pool (${owner!.pool}) belongs to ${owner!.user} (uid ${owner!.uid})`);
      const run = Bun.spawnSync(["sh", "-c", `sudo() { printf '%s\\0' "$@"; }; ${refusal.split("run it as that user: ")[1]}`]);
      expect(run.stdout.toString().split("\0").slice(0, -1), JSON.stringify(command)).toEqual(["-u", owner!.user, "env", ...("home" in owner! ? [`HOME=${owner.home}`] : []), `XDG_RUNTIME_DIR=/run/user/${owner!.uid}`, ...command]);
      expect(wrongUser(owners[next(2)]!.uid, owners, command)).toBeUndefined();
      expect(wrongUser(0, [], command)).toBeUndefined();
    }
  });

  test("[spec docs/lan.md] --network opens exactly one named pair for solo games, every other start stays offline, and a networked pair refuses each LAN play command", () => {
    expect(networkFlagProblem(["--pair", "16", "--network"])).toBeUndefined();
    expect(networkFlagProblem(["--pairs", "2"])).toBeUndefined();
    for (const args of [["--network"], ["--pairs", "2", "--network"], ["--pair", "1", "--pair", "2", "--network"]]) expect(networkFlagProblem(args)).toContain("exactly one --pair K");
    expect(pairFlags(["--pair", "16", "--network"]).network).toBe(true);
    expect(pairFlags(["--pair", "16"]).network).toBe(false);
    for (const command of ["fresh", "dummy", "netem"] as const) {
      expect(lanPlayRefusal(16, true, command)).toContain(`lan ${command} runs only on an offline pair`);
      expect(lanPlayRefusal(16, false, command)).toBeUndefined();
    }
  });

  test("[spec docs/lan.md] a networked pair launches and lists only its side a client, and an offline pair keeps both sides", () => {
    expect(pairSides(true)).toEqual(["a"]);
    expect(pairSides(false)).toEqual(["a", "b"]);
    expect(pairClients(16, { a: "/run/a" }, pairSides(true)).map(({ name, run }) => ({ name, run }))).toEqual([{ name: "lan16a", run: "/run/a" }]);
    expect(pairClients(16, { a: "/run/a", b: "/run/b" }, pairSides(false)).map(({ name }) => name)).toEqual(["lan16a", "lan16b"]);
  });

  test("[spec docs/lan.md] a pair whose driver died is idle at once and raises its alarm after the owner's ten minutes, a pair with a client down is dead, a pair playing a game is busy, and every pair counts whole idle seconds from its last start, end or dead driver", () => {
    const goneAt = "2026-10-11T10:00:00.000Z";
    expect(driverVerdict({ pid: 7, since: "2026-10-11T09:00:00.000Z" }, Date.parse(goneAt) + ALARM_AFTER_MS)).toEqual({ alarm: false });
    const gone = { pid: 7, since: "2026-10-11T09:00:00.000Z", goneAt };
    expect(driverVerdict(gone, Date.parse(goneAt) + ALARM_AFTER_MS - 1)).toEqual({ idle: `idle since ${goneAt}, driver gone`, alarm: false });
    expect(driverVerdict(gone, Date.parse(goneAt) + ALARM_AFTER_MS).alarm).toBe(true);
    expect(ALARM_AFTER_MS).toBe(600_000);

    let seed = 128;
    const next = (below: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed >>> 16) % below;
    };
    for (let sample = 0; sample < 200; sample++) {
      let now = Date.parse("2026-10-11T09:00:00.000Z") + next(1000);
      const started = new Date(now).toISOString();
      let ended: string | undefined;
      let driver: Driver | undefined;
      let idleStart = now;
      let previous: number | undefined;
      const trace: string[] = ["start"];
      for (let step = 0; step < 40; step++) {
        now += next(4) === 0 ? next(2_000_000) : next(3000);
        const event = next(5);
        if (event === 0) {
          driver = { pid: 1 + next(9), since: new Date(now).toISOString() };
          ended = new Date(now).toISOString();
          trace.push(`drive ${driver.pid}`);
        } else if (event === 1) {
          driver = undefined;
          ended = new Date(now).toISOString();
          idleStart = now;
          previous = undefined;
          trace.push("end");
        } else if (event === 2 && driver !== undefined && driver.goneAt === undefined) {
          driver = { ...driver, goneAt: new Date(now).toISOString() };
          idleStart = now;
          previous = undefined;
          trace.push("gone");
        } else {
          const playing = next(3) === 0;
          const down = next(4) === 0 ? ["lan0b"] : [];
          const read = idleness(started, ended, driver, playing, down, now);
          const live = playing || (driver !== undefined && driver.goneAt === undefined);
          trace.push(`read +${now - idleStart} ms${playing ? " playing" : ""}${down.length > 0 ? " down" : ""}`);
          const why = trace.join(", ");
          if (down.length > 0) {
            expect(read.state, why).toBe("dead");
            expect(read.down, why).toEqual(down);
            expect(read.idleSeconds, why).toBe(0);
            continue;
          }
          expect(read.state, why).toBe(live ? "busy" : "idle");
          if (live) {
            expect(read.idleSeconds, why).toBe(0);
            previous = undefined;
          } else {
            expect(read.idleSince, why).toBe(new Date(idleStart).toISOString());
            expect(read.idleSeconds, why).toBe(Math.floor((now - idleStart) / 1000));
            expect(read.idleSeconds, why).toBeGreaterThanOrEqual(previous ?? 0);
            previous = read.idleSeconds;
          }
        }
      }
    }
  });
});

describe("setup without reflinks", () => {
  test("[integration cp on tmpfs] clients copy everything outside Data, hardlink Data, leave the source's menu page alone and relink a replaced Data file on refresh", async () => {
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
      const lines: string[] = [];
      const setup = (name: string) => {
        mkdirSync(join(installOf(name), ".."), { recursive: true });
        writeFileSync(join(prefixOf(name), "user.reg"), "");
        return Effect.runPromise(setupClient(name, from, "3.0.0.24268", 47200, (line) => lines.push(line)).pipe(
          Effect.provideService(GameLauncher, GameLauncher.of({ inPrefix: () => Effect.die("setup made a prefix") }))));
      };
      const filesOf = (name: string) => readdirSync(installOf(name), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
      await setup("lan0a");
      await setup("lan0b");
      for (const name of ["lan0a", "lan0b"]) {
        expect(statSync(join(installOf(name), "Data/data/data.000")).ino).toBe(statSync(join(from, "Data/data/data.000")).ino);
        expect(filesOf(name).filter((path) => !path.includes("/Data/")).map((path) => [path, statSync(path).nlink])).toEqual(
          [".build.info", "_retail_/x86_64/Warcraft III.exe", "_retail_/webui/index.html"].map((path) => [join(installOf(name), path), 1]).sort());
      }
      expect(readFileSync(join(from, "_retail_/webui/index.html"), "utf8")).toBe(menuPage(47123));
      file("_retail_/x86_64/Warcraft III.exe", "exe 22");
      file("Data/data/data.000.next", "archive 2");
      renameSync(join(from, "Data/data/data.000.next"), join(from, "Data/data/data.000"));
      await setup("lan0a");
      expect(statSync(join(installOf("lan0a"), "Data/data/data.000")).ino).toBe(statSync(join(from, "Data/data/data.000")).ino);
      expect(readFileSync(join(installOf("lan0b"), "Data/data/data.000"), "utf8")).toBe("archive 1");
      expect(readFileSync(join(installOf("lan0a"), "_retail_/x86_64/Warcraft III.exe"), "utf8")).toBe("exe 22");
      expect(readFileSync(join(from, "_retail_/webui/index.html"), "utf8")).toBe(menuPage(47123));
      expect(lines.filter((line) => line.includes("install"))).toEqual([
        "lan0a: install linked (Data hardlinked, 0 MB copied) from " + from,
        "lan0b: install linked (Data hardlinked, 0 MB copied) from " + from,
        expect.stringMatching(/^lan0a: install refreshed, linked \(Data hardlinked, 0 MB copied\) \(executable was 5 bytes, .*now 6 bytes/),
      ]);
    } finally {
      if (dataHome === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = dataHome;
      rmSync(root, { recursive: true, force: true });
    }
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

describe("map facts", () => {
  test("[integration child process] an extractor the dynamic loader can't start fails as a load error naming the missing library, not as a map without war3map.w3i", async () => {
    const root = mkdtempSync(join(tmpdir(), "wisp-map-facts-"));
    const packager = join(root, "map-pack");
    writeFileSync(packager, "#!/bin/sh\necho \"$0: error while loading shared libraries: libstorm.so.9: cannot open shared object file: No such file or directory\" >&2\nexit 127\n");
    chmodSync(packager, 0o755);
    mkdirSync(join(root, "Maps/Wisp"), { recursive: true });
    writeFileSync(join(root, "Maps/Wisp/broken.w3x"), "a map the extractor never opens");
    const exit = await Effect.runPromiseExit(readMapFacts(join(root, "Maps/Wisp/broken.w3x"), packager, "Maps\\Wisp\\broken.w3x").pipe(Effect.provide(BunServices.layer)));
    rmSync(root, { recursive: true, force: true });
    expect(Exit.isFailure(exit)).toBe(true);
    const problem = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
    expect(problem).toBeInstanceOf(LanFailure);
    expect((problem as LanFailure).problem).toContain(`the map packager ${packager} could not load libstorm.so.9 (exit 127)`);
    expect((problem as LanFailure).problem).not.toContain("war3map.w3i");
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
