import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isLocalAddress, onlineProblem, ownerProblem, parseInterfaces, parseSocketTable, tcpAddress } from "../scripts/wisp/engine/attach";
import { compareDesyncLogs, compareDumps, fourCC, ipseStates, pairDumps, parseDesyncLog } from "../scripts/wisp/engine/desyncLog";
import { procMemory } from "../scripts/wisp/engine/memory";
import { OFFSETS_FILE, offsetsEntry, offsetsFor, parseOffsets } from "../scripts/wisp/engine/offsets";
import { readFixture, replayFixture } from "../scripts/wisp/engine/locatorFixture";
import { stopWatch } from "../scripts/wisp/engine/stopWatch";
import { followsCall } from "../scripts/wisp/engine/perfData";

const fixtures = join(import.meta.dir, "fixtures/engine");
const parse = (name: string) => {
  const dumps = parseDesyncLog(readFileSync(join(fixtures, name), "latin1"));
  if (typeof dumps === "string") throw new Error(dumps);
  return dumps;
};

test("[native] Desync.log dumps pair by desync turn and name Tempest's presence table as the first difference", () => {
  const a = parse("a_Desync.log");
  const b = parse("b_Desync.log");
  expect(a.map(({ turn }) => turn)).toEqual([921]);
  // B's log holds an older game's dump before this one.
  expect(b.map(({ turn }) => turn)).toEqual([400, 921]);
  expect(fourCC(1768977253)).toBe("ipse");
  expect(fourCC(7)).toBe("7");
  const pair = pairDumps(a, b);
  if (typeof pair === "string") throw new Error(pair);
  expect(pair.indexB).toBe(1);
  const differences = compareDumps(pair.a, pair.b);
  expect(differences.map(({ section, turn }) => [section, turn])).toEqual([["ipse", 921]]);
  expect(differences[0]?.records).toEqual([["#1", "0x000016F7", "0x000016F8"], ["#2", "0x00001888", "0x00001887"]]);
  expect(ipseStates(pair.a).at(-1)).toMatchObject({ turn: 921, presenceTag: 5879, birthTag: 6280 });
  // Nested records keep their group's path.
  expect(pair.a.blocks.find(({ section }) => section === "cust")?.records.map(({ path }) => path)).toEqual(["#plat", "#plat/#plyz", "#plat/#1886157180", "#plat"]);
  const report = compareDesyncLogs(join(fixtures, "a_Desync.log"), join(fixtures, "b_Desync.log"));
  expect(report).toContain("first difference: turn 921, section ipse");
  expect(report).toContain("turn 921: births B-A -1, free head B-A +1");
  expect(report).toContain("only Tempest's presence table differs");
});

test("[invariant] a desync in another section names it at its first differing turn", () => {
  const report = compareDesyncLogs(join(fixtures, "rand-a_Desync.log"), join(fixtures, "rand-b_Desync.log"));
  expect(report).toContain("first difference: turn 498, section rand");
  expect(report).toContain("#1: A 0x01C02204 B 0x01C02205");
  expect(report).not.toContain("only Tempest's presence table differs");
});

test("[invariant] an offsets.json entry round-trips through locate's entry", () => {
  const offsets = offsetsFor("3.0.0.24268");
  if (typeof offsets === "string") throw new Error(offsets);
  expect(parseOffsets(JSON.stringify(offsetsEntry(offsets))).get("3.0.0.24268")).toEqual(offsets);
});

test("[native] every build after 3.0.0.24268 in offsets.json has a locator fixture that its entry still finds", () => {
  const builds = join(fixtures, "builds");
  const recorded = new Map(readdirSync(builds).filter((name) => name.endsWith(".json")).map((name) => {
    const fixture = readFixture(join(builds, name));
    return [fixture.version, fixture] as const;
  }));
  const all = parseOffsets(readFileSync(OFFSETS_FILE, "utf8"));
  for (const [version, offsets] of all) {
    if (version === "3.0.0.24268") continue;
    const fixture = recorded.get(version);
    expect(fixture, `no locator fixture for ${version} in ${builds}`).toBeDefined();
    if (fixture === undefined) continue;
    expect(fixture.sizeOfImage).toBe(`0x${offsets.sizeOfImage.toString(16)}`);
    expect(fixture.scan.candidates.map(({ rva }) => rva)).toContain(`0x${offsets.presenceTable.toString(16)}`);
    const replayed = replayFixture(fixture, offsets);
    expect(replayed).toMatchObject(fixture.scan.candidates.map(({ sampled, matching }) => ({ sampled, matching })));
    // The map's Lua VM: a VM whose globals hold a Wisp map's functions.
    expect(fixture.lua.some(({ chunks }) => Object.keys(chunks).some((source) => source.startsWith("map-")))).toBe(true);
  }
  for (const version of recorded.keys()) expect(all.has(version), `fixture for ${version} has no offsets.json entry`).toBe(true);
});

test("[reference] x86-64 call encodings before return addresses: direct, register and memory calls, not other bytes", () => {
  const before = (...bytes: number[]) => Buffer.from([...Array(7 - bytes.length).fill(0x90), ...bytes]);
  expect(followsCall(before(0xe8, 1, 2, 3, 4))).toBe(true);
  expect(followsCall(before(0xff, 0x15, 1, 2, 3, 4))).toBe(true);
  expect(followsCall(before(0xff, 0xd0))).toBe(true);
  expect(followsCall(before(0x41, 0xff, 0xd3))).toBe(true);
  expect(followsCall(before(0xff, 0x50, 0x08))).toBe(true);
  expect(followsCall(before(0xff, 0x54, 0x24, 0x08))).toBe(true);
  expect(followsCall(before(0xff, 0x90, 1, 2, 3, 4))).toBe(true);
  expect(followsCall(before(0x48, 0x89, 0x44, 0x24, 0x08))).toBe(false);
  expect(followsCall(before(0xff, 0xe0))).toBe(false);
});

test("[spec docs/engine.md] guardrails: breakpoints need an offline client; reads never touch the owner's own game", () => {
  // /proc/net/tcp rows: a loopback listener, a LAN peer, and Battle.net's port 1119 on a public address.
  const tcp = [
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: 0100007F:B825 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 101 1 0000000000000000 100 0 0 10 0",
    "   1: 0A00A8C0:C350 0B00A8C0:17E0 01 00000000:00000000 00:00000000 00000000  1000        0 102 1 0000000000000000 20 4 30 10 -1",
    "   2: 0A00A8C0:C351 0A0B0C0D:045F 01 00000000:00000000 00:00000000 00000000  1000        0 103 1 0000000000000000 20 4 30 10 -1",
  ].join("\n");
  const connections = parseSocketTable(tcp, "tcp");
  expect(connections.map(({ remote, remotePort, state, inode }) => [remote, remotePort, state, inode])).toEqual([["0.0.0.0", 0, 10, 101], ["192.168.0.11", 6112, 1, 102], ["13.12.11.10", 1119, 1, 103]]);
  expect(tcpAddress("0000000000000000FFFF00000100007F")).toBe("127.0.0.1");
  expect(["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.0.1"].every(isLocalAddress)).toBe(true);
  expect(["13.12.11.10", "172.32.0.1", "8.8.8.8"].some(isLocalAddress)).toBe(false);
  const devices = "Inter-|   Receive\n face |bytes\n    lo: 1 2 3\n";
  expect(parseInterfaces(`${devices}  eth0: 4 5 6\n`)).toEqual(["lo", "eth0"]);
  // An offline client also passes -launch; Battle.net adds -uid.
  const offline = { pid: 9, commandLine: "C:\\Warcraft III.exe\0-launch\0-windowmode\0windowed\0", prefixCommandLines: ["C:\\windows\\system32\\services.exe\0"], sockets: new Set([101, 102]), connections, interfaces: parseInterfaces(devices) };
  expect(onlineProblem(offline)).toBeUndefined();
  expect(onlineProblem({ ...offline, commandLine: "C:\\Warcraft III.exe\0-launch\0-uid\0w3\0" })).toContain("started by Battle.net");
  expect(onlineProblem({ ...offline, interfaces: ["lo", "eth0"] })).toContain("interfaces eth0");
  expect(onlineProblem({ ...offline, interfaces: [] })).toContain("no readable interface list");
  expect(onlineProblem({ ...offline, prefixCommandLines: ["C:\\Program Files (x86)\\Battle.net\\Battle.net.exe\0"] })).toContain("Battle.net runs in this client's prefix");
  // The game's own menu renderer is not Battle.net.
  expect(onlineProblem({ ...offline, prefixCommandLines: ["C:\\Program Files (x86)\\Warcraft III\\_retail_\\x86_64\\BlizzardBrowser\\BlizzardBrowser.exe\0--type=gpu-process\0"] })).toBeUndefined();
  expect(onlineProblem({ ...offline, sockets: new Set([101, 102, 103]) })).toContain("tcp connection to 13.12.11.10:1119");
  const udp = parseSocketTable(tcp.replace(" 01 00000000", " 07 00000000"), "udp");
  expect(onlineProblem({ ...offline, sockets: new Set([103]), connections: udp })).toContain("udp connection to 13.12.11.10:1119");
  expect(ownerProblem("WINEPREFIX=/x/pfx/\0DISPLAY=:0\0")).toContain("owner's display");
  expect(ownerProblem("WINEPREFIX=/x/pfx/\0DISPLAY=:1\0")).toBeUndefined();
});

test("[invariant] stopWatch stops the writing thread at each write and lets it go", async () => {
  const child = Bun.spawn([process.execPath, join(fixtures, "writer.ts")], { stdin: "pipe", stdout: "pipe" });
  const { value } = await child.stdout.getReader().read();
  const address = Number(new TextDecoder().decode(value).trim());
  await Bun.sleep(200);
  const memory = procMemory(child.pid);
  const values: number[] = [];
  const hits = stopWatch({ tid: child.pid, address, seconds: 60, limit: 5, onHit: () => values.push(memory.read(address, 4).readInt32LE(0)) });
  memory.close();
  await child.stdin.end();
  expect(hits).toBe(5);
  // Each stop lands right after one write.
  expect(values.slice(1).map((v, index) => v - (values[index] ?? 0))).toEqual([1, 1, 1, 1]);
  expect(await child.exited).toBe(0);
}, 120_000);
