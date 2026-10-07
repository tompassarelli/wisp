import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isLocalAddress, onlineProblem, ownerProblem, parseInterfaces, parseSocketTable, tcpAddress } from "../scripts/wisp/engine/attach";
import { compareDesyncLogs, compareDumps, fourCC, ipseStates, pairDumps, parseDesyncLog } from "../scripts/wisp/engine/desyncLog";
import { type Mapping, type Memory, fileVersion, findImageBase, functionAt, memoryAccessProblem, parseMaps, peHeader, prefixOfDocuments, prefixPath, procMemory } from "../scripts/wisp/engine/memory";
import { OFFSETS_FILE, offsetsEntry, offsetsFor, parseOffsets } from "../scripts/wisp/engine/offsets";
import { closureFunction, frameText, globalFunctionNames, isLuaState, luaStack, scriptFuncDefinition } from "../scripts/wisp/engine/lua";
import { stopWatch } from "../scripts/wisp/engine/stopWatch";
import { followsCall, parsePerfData, sampleFrames } from "../scripts/wisp/engine/perfData";
import { PresenceTracker, demangle, scanForPresenceTable } from "../scripts/wisp/engine/presence";
import { diffPresenceLogs, eventLine, parsePresenceLog } from "../scripts/wisp/engine/presenceLog";

const fixtures = join(import.meta.dir, "fixtures/engine");
const parse = (name: string) => {
  const dumps = parseDesyncLog(readFileSync(join(fixtures, name), "latin1"));
  if (typeof dumps === "string") throw new Error(dumps);
  return dumps;
};

test("Desync.log dumps pair by desync turn and name Tempest's presence table as the first difference", () => {
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

test("a desync in another section names it at its first differing turn", () => {
  const report = compareDesyncLogs(join(fixtures, "rand-a_Desync.log"), join(fixtures, "rand-b_Desync.log"));
  expect(report).toContain("first difference: turn 498, section rand");
  expect(report).toContain("#1: A 0x01C02204 B 0x01C02205");
  expect(report).not.toContain("only Tempest's presence table differs");
  expect(parseDesyncLog("[Desync - 1 - Turn(1) = 0]\r\nnonsense")).toContain("line 2");
});

test("live commands refuse at ptrace_scope 1 with the owner's set and restore commands", () => {
  expect(memoryAccessProblem("0\n")).toBeUndefined();
  expect(memoryAccessProblem(undefined)).toBeUndefined();
  const problem = memoryAccessProblem("1\n") ?? "";
  expect(problem).toContain("sudo sysctl kernel.yama.ptrace_scope=0");
  expect(problem).toContain("sudo sysctl kernel.yama.ptrace_scope=1");
});

test("the offsets file has 3.0.0.24268 and round-trips through locate's entry", () => {
  const offsets = offsetsFor("3.0.0.24268");
  if (typeof offsets === "string") throw new Error(offsets);
  expect(offsets.presenceTable).toBe(0x2f80770);
  expect(offsets.roles.get(0x24d7d0)).toBe("tag allocator");
  expect(parseOffsets(JSON.stringify(offsetsEntry(offsets))).get("3.0.0.24268")).toEqual(offsets);
  expect(offsetsFor("9.9.9.1", OFFSETS_FILE)).toContain("wisp engine locate");
});

test("Wine paths: a client's prefix from its Documents folder, its executable from the Windows command line", () => {
  expect(prefixOfDocuments("/x/client-a/pfx/drive_c/users/steamuser/Documents/Warcraft III")).toBe("/x/client-a/pfx");
  expect(prefixPath("/x/pfx", "C:\\Program Files (x86)\\Warcraft III\\_retail_\\x86_64\\Warcraft III.exe")).toBe("/x/pfx/drive_c/Program Files (x86)/Warcraft III/_retail_/x86_64/Warcraft III.exe");
});

// A synthetic client: an image whose header, RTTI and .data hold a pointer to
// a presence table in 3.0.0.24268's layout, on a heap of agents.
const BASE = 0x140000000;
const HEAP = 0x10000000;
const SIZE_OF_IMAGE = 0x10000;
const DATA_RVA = 0x2000;
const TABLE_RVA = 0x2770;
const ENTRIES = HEAP + 0x1000;
const AGENTS = HEAP + 0x4000;
const OWNER = HEAP + 0x9000;

class SparseMemory implements Memory {
  readonly regions: { start: number; bytes: Buffer }[] = [];
  region(start: number, length: number) {
    const bytes = Buffer.alloc(length);
    this.regions.push({ start, bytes });
    return bytes;
  }
  at(address: number): [Buffer, number] {
    const region = this.regions.find(({ start, bytes }) => address >= start && address < start + bytes.length);
    if (region === undefined) throw new Error(`unmapped 0x${address.toString(16)}`);
    return [region.bytes, address - region.start];
  }
  read(address: number, length: number): Buffer {
    const [bytes, offset] = this.at(address);
    if (offset + length > bytes.length) throw new Error("crosses a region");
    return Buffer.from(bytes.subarray(offset, offset + length));
  }
  u64(address: number, value: number) { const [bytes, offset] = this.at(address); bytes.writeBigUInt64LE(BigInt(value), offset); }
  u32(address: number, value: number) { const [bytes, offset] = this.at(address); bytes.writeUInt32LE(value >>> 0, offset); }
  i32(address: number, value: number) { const [bytes, offset] = this.at(address); bytes.writeInt32LE(value, offset); }
  text(address: number, value: string) { const [bytes, offset] = this.at(address); bytes.write(value, offset, "latin1"); }
}

function syntheticClient() {
  const memory = new SparseMemory();
  const header = memory.region(BASE, 0x1000);
  header.writeUInt16LE(0x5a4d, 0);
  header.writeUInt32LE(0x80, 0x3c);
  header.writeUInt32LE(0x4550, 0x80);
  header.writeUInt16LE(1, 0x86);
  header.writeUInt32LE(0x6aa4de70, 0x88);
  header.writeUInt16LE(0xf0, 0x94);
  header.writeUInt32LE(SIZE_OF_IMAGE, 0x80 + 24 + 56);
  header.write(".data", 0x80 + 24 + 0xf0, "latin1");
  header.writeUInt32LE(0x2000, 0x80 + 24 + 0xf0 + 8);
  header.writeUInt32LE(DATA_RVA, 0x80 + 24 + 0xf0 + 12);
  memory.region(BASE + 0x1000, 0x1000);
  memory.region(BASE + DATA_RVA, 0x2000);
  // The whole-image alias Wine also maps: same header, not where code runs.
  memory.region(0x7f0000000000, SIZE_OF_IMAGE).set(header);
  const classes = new Map<string, number>();
  for (const [index, name] of [".?AVCAgentBaseAbs@@", ".?AVCScriptFunc@@", ".?AVCPoFlag@NIpse@@"].entries()) {
    const vtable = BASE + 0x1100 + index * 0x300;
    const locator = vtable + 0x100;
    const descriptor = vtable + 0x200;
    memory.u64(vtable - 8, locator);
    memory.u32(locator, 1);
    memory.u32(locator + 12, descriptor - BASE);
    memory.text(descriptor + 16, `${name}\0`);
    classes.set(name, vtable);
  }
  memory.region(HEAP, 0x10000);
  const table = HEAP;
  memory.u64(BASE + TABLE_RVA, table);
  memory.u64(table + 0x18, ENTRIES);
  memory.u32(table + 0x30, 32);
  memory.i32(table + 0x70, -1);
  memory.u32(table + 0x80, 40);
  memory.u64(OWNER, classes.get(".?AVCScriptFunc@@") ?? 0);
  const agent = (tag: number, birth: number, vtable: number) => {
    const object = AGENTS + tag * 0x100;
    memory.u64(object, vtable);
    memory.u32(object + 0x20, tag);
    memory.i32(object + 0x24, birth);
    memory.u64(object + 0x90, OWNER);
    memory.i32(ENTRIES + tag * 16, -2);
    memory.u64(ENTRIES + tag * 16 + 8, object);
  };
  for (let tag = 0; tag < 32; tag++) agent(tag, tag + 8, classes.get(tag % 4 === 0 ? ".?AVCPoFlag@NIpse@@" : ".?AVCAgentBaseAbs@@") ?? 0);
  const maps: Mapping[] = parseMaps([
    `${BASE.toString(16)}-${(BASE + 0x1000).toString(16)} r--p 00000000 00:01 7 /memfd:wine-mapping (deleted)`,
    `${(BASE + 0x1000).toString(16)}-${(BASE + 0x2000).toString(16)} r--p 00001000 00:01 7 /memfd:wine-mapping (deleted)`,
    `${(BASE + DATA_RVA).toString(16)}-${(BASE + 0x4000).toString(16)} rw-p 00002000 00:01 7 /memfd:wine-mapping (deleted)`,
    `${HEAP.toString(16)}-${(HEAP + 0x10000).toString(16)} rw-p 00000000 00:00 0`,
    `7f0000000000-${(0x7f0000000000 + SIZE_OF_IMAGE).toString(16)} r--s 00000000 00:01 7 /memfd:wine-mapping (deleted)`,
  ].join("\n")).sort((x, y) => x.start - y.start);
  return { memory, maps, header, classes, agent, table };
}

test("a synthetic client: image base, the presence table found by scanning .data, births and frees with their classes", () => {
  const { memory, maps, header, classes, agent, table } = syntheticClient();
  const exe = peHeader(header);
  if (exe === undefined) throw new Error("no header");
  expect(exe.sections.map(({ name }) => name)).toEqual([".data"]);
  expect(findImageBase([...maps].reverse(), memory, exe)).toBe(BASE);
  const known = offsetsFor("3.0.0.24268");
  if (typeof known === "string") throw new Error(known);
  const layout = { ...known, sizeOfImage: SIZE_OF_IMAGE, presenceTable: TABLE_RVA };
  const found = scanForPresenceTable(memory, maps, BASE, DATA_RVA, 0x2000, layout);
  expect(found.map(({ rva, table: at, header: { count, births } }) => [rva, at, count, births])).toEqual([[TABLE_RVA, table, 32, 40]]);

  const tracker = new PresenceTracker(memory, BASE, layout);
  expect(tracker.poll()).toEqual([]);
  expect(tracker.live().get(4)?.className).toBe("NIpse::CPoFlag");
  expect(tracker.live().get(5)).toMatchObject({ birth: 13, className: "CAgentBaseAbs", owner: "CScriptFunc" });
  expect(tracker.poll()).toEqual([]);
  // Tag 5 is freed; a code callback's agent is born in a new tag 32.
  memory.i32(ENTRIES + 5 * 16, -1);
  memory.i32(table + 0x70, 5);
  memory.region(ENTRIES + 32 * 16, 16);
  memory.region(AGENTS + 32 * 0x100, 0x100);
  agent(32, 40, classes.get(".?AVCAgentBaseAbs@@") ?? 0);
  memory.u32(table + 0x30, 33);
  memory.u32(table + 0x80, 41);
  const events = tracker.poll();
  expect(events.map((event) => eventLine(1.5, event))).toEqual([
    "1.500 freed 13 tag 5 CAgentBaseAbs owner CScriptFunc",
    "1.500 born 40 tag 32 CAgentBaseAbs owner CScriptFunc",
  ]);
  expect(demangle(".?AV?$TSList@VCFoo@@@@")).toBe(".?AV?$TSList@VCFoo@@@@");
});

test("poll logs align by birth number: a birth made at another moment on one client stands out", () => {
  const log = (offset: number, late: number) => [
    "# wisp engine poll: client x",
    ...Array.from({ length: 20 }, (_, index) => {
      const birth = 6270 + index;
      const seconds = 10 + index * 0.05 + offset + (birth === 6279 ? late : 0);
      return `${seconds.toFixed(3)} born ${birth} tag ${4000 + index} ${birth === 6279 ? "CAgentBaseAbs owner CScriptFunc" : "CAgentBaseAbs owner CTimerWar3"}`;
    }),
    "11.000 freed 6271 tag 4001 CAgentBaseAbs owner CTimerWar3",
  ].join("\n");
  const a = parsePresenceLog(log(0.004, 0));
  const b = parsePresenceLog(log(0, 0.3).replace(/^11\.000 freed.*$/m, ""));
  expect(a).toHaveLength(21);
  const report = diffPresenceLogs(["a.log", "b.log"], a, b, { skew: 0.1, limit: 5 });
  expect(report).toContain("births 6270..6289: 20 in both, 0 only in A, 0 only in B");
  expect(report).toContain("every birth in both logs has the same class");
  expect(report).toContain("A-B time per birth: median +0.004 s");
  expect(report).toContain("birth 6279 CAgentBaseAbs owner CScriptFunc: A 10.454 B 10.750 (-0.300 s)");
  expect(report).toContain("freed only on A: birth 6271");
  // A shifted birth order shows as a class difference.
  const swapped = parsePresenceLog(log(0, 0).replace("born 6279 tag 4009 CAgentBaseAbs owner CScriptFunc", "born 6279 tag 4009 CAgentBaseAbs owner CTimerWar3"));
  expect(diffPresenceLogs(["a", "b"], a, swapped, { skew: 0.1, limit: 5 })).toContain("first class difference: birth 6279 (1 births differ)");
});

test("call sites before return addresses: direct, register and memory calls, not other bytes", () => {
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

test("perf.data samples: the write's instruction and the stack's return addresses, named by role", () => {
  // perf_file_header, one attr, then a lost record and one sample.
  const SAMPLE_TYPE = 1 | 2 | 4 | 32 | 0x1000 | 0x2000;
  const attr = Buffer.alloc(136);
  attr.writeBigUInt64LE(BigInt(SAMPLE_TYPE), 24);
  attr.writeBigUInt64LE((1n << 7n) | (1n << 8n), 80);
  const stack = Buffer.alloc(32);
  stack.writeBigUInt64LE(0x1234n, 0);
  stack.writeBigUInt64LE(BigInt(BASE + 0x231798), 8);
  stack.writeBigUInt64LE(BigInt(BASE + 0x19b745), 16);
  const body = Buffer.concat([
    Buffer.from(new BigUint64Array([BigInt(BASE + 0x24d8b7)]).buffer),
    Buffer.from(new Uint32Array([77, 78]).buffer),
    Buffer.from(new BigUint64Array([5_000_000_000n, 1n, 0xffffffffffffff80n, 2n, 0x10n, 0x20n, 32n]).buffer),
    stack,
    Buffer.from(new BigUint64Array([24n]).buffer),
  ]);
  const sample = Buffer.concat([Buffer.alloc(8), body]);
  sample.writeUInt32LE(9, 0);
  sample.writeUInt16LE(sample.length, 6);
  const lost = Buffer.alloc(24);
  lost.writeUInt32LE(2, 0);
  lost.writeUInt16LE(24, 6);
  lost.writeBigUInt64LE(3n, 16);
  const data = Buffer.concat([lost, sample]);
  const head = Buffer.alloc(104);
  head.write("PERFILE2", 0, "latin1");
  head.writeBigUInt64LE(104n, 8);
  head.writeBigUInt64LE(152n, 16);
  head.writeBigUInt64LE(104n, 24);
  head.writeBigUInt64LE(152n, 32);
  head.writeBigUInt64LE(256n, 40);
  head.writeBigUInt64LE(BigInt(data.length), 48);
  const file = Buffer.concat([head, attr, Buffer.alloc(16), data]);
  const parsed = parsePerfData(file);
  expect(parsed.lost).toBe(3);
  expect(parsed.samples).toHaveLength(1);
  expect(parsed.samples[0]).toMatchObject({ pid: 77, tid: 78, ip: BASE + 0x24d8b7, time: 5_000_000_000n });
  expect(parsed.samples[0]?.stack.length).toBe(24);
  const offsets = offsetsFor("3.0.0.24268");
  if (typeof offsets === "string") throw new Error(offsets);
  const functions = new Uint32Array([0x19b550, 0x19b762, 0, 0x231720, 0x23183b, 0, 0x24d7d0, 0x24d8c5, 0]);
  expect(functionAt(functions, 0x231798)).toBe(0x231720);
  expect(functionAt(functions, 0x19b762)).toBeUndefined();
  // The client's code: a call before 0x231798, data before 0x19b745.
  const code = new SparseMemory();
  code.region(BASE + 0x231798 - 7, 7).set([0x90, 0x90, 0xe8, 0, 0, 0, 0]);
  code.region(BASE + 0x19b745 - 7, 7).set([0x48, 0x89, 0x44, 0x24, 0x08, 0x90, 0x90]);
  const symbolizer = { base: BASE, codeEnd: 0x2260000, functions, offsets, memory: code };
  const frames = (memory: Memory | undefined) => parsed.samples[0] === undefined ? [] : sampleFrames(parsed.samples[0], { ...symbolizer, memory }).map(({ label }) => label);
  expect(frames(code)).toEqual(["tag allocator+0xe7", "CAgentBaseAbs allocator+0x78"]);
  expect(frames(undefined)).toEqual(["tag allocator+0xe7", "CAgentBaseAbs allocator+0x78", "fn 0x19b550+0x1f5"]);
});

test("file versions come from VS_FIXEDFILEINFO", () => {
  const resources = Buffer.alloc(64);
  resources.set([0xbd, 0x04, 0xef, 0xfe], 16);
  resources.writeUInt32LE((3 << 16) | 0, 24);
  resources.writeUInt32LE((0 << 16) | 24268, 28);
  expect(fileVersion(resources)).toBe("3.0.0.24268");
  expect(fileVersion(Buffer.alloc(8))).toBeUndefined();
});

test("guardrails: breakpoints need an offline client; reads never touch the owner's own game", () => {
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

test("a synthetic Lua 5.3.4 VM: the call stack from CallInfo, lines from savedpc, natives named from _G", () => {
  const memory = new SparseMemory();
  const H = 0x20000000;
  memory.region(H, 0x10000);
  const L = H, G = H + 0x400, REGISTRY = H + 0x800, ARRAY = H + 0x900, GLOBALS = H + 0xa00, NODES = H + 0xb00;
  const NAME = H + 0xc00, SOURCE = H + 0xd00, CI_C = H + 0xe00, CI_LUA = H + 0xe80, STACK = H + 0xf00;
  const CLOSURE = H + 0x1000, PROTO = H + 0x1100, CODE = H + 0x1200, LINES = H + 0x1300;
  const NATIVE = 0x140100000;
  const tvalue = (at: number, value: number, tag: number) => { memory.u64(at, value); memory.u32(at + 8, tag); };
  const tstring = (at: number, text: string) => { memory.text(at + 8, "\x04"); memory.text(at + 11, String.fromCharCode(text.length)); memory.text(at + 24, text); };
  memory.text(L + 8, "\x08");
  memory.u64(L + 24, G);
  memory.u64(L + 32, CI_C);
  memory.u64(G + 200, L);
  tvalue(G + 64, REGISTRY, 0x45);
  memory.u64(REGISTRY + 16, ARRAY);
  tvalue(ARRAY + 16, GLOBALS, 0x45);
  memory.text(GLOBALS + 11, "\x01");
  memory.u64(GLOBALS + 24, NODES);
  tvalue(NODES, NATIVE, 0x16);
  tvalue(NODES + 16, NAME, 0x44);
  tstring(NAME, "TimerStart");
  tstring(SOURCE, "@map-1-2");
  // The innermost call: the native, called from a Lua function at its third instruction.
  tvalue(STACK, NATIVE, 0x16);
  memory.u64(CI_C, STACK);
  memory.u64(CI_C + 16, CI_LUA);
  tvalue(STACK + 16, CLOSURE, 0x46);
  memory.u64(CI_LUA, STACK + 16);
  memory.u64(CI_LUA + 16, L + 96);
  memory.u64(CI_LUA + 40, CODE + 3 * 4);
  memory.text(CI_LUA + 66, "\x02");
  memory.u64(CLOSURE + 24, PROTO);
  memory.i32(PROTO + 40, 148);
  memory.i32(PROTO + 44, 152);
  memory.u32(PROTO + 28, 4);
  memory.u64(PROTO + 56, CODE);
  memory.u64(PROTO + 72, LINES);
  memory.u64(PROTO + 104, SOURCE);
  for (const [index, line] of [148, 149, 150, 151].entries()) memory.i32(LINES + index * 4, line);
  expect(isLuaState(memory, L)).toBe(true);
  expect(isLuaState(memory, G)).toBe(false);
  expect(closureFunction(memory, CLOSURE)).toEqual({ source: "map-1-2", linedefined: 148, lastlinedefined: 152 });
  const names = globalFunctionNames(memory, L);
  expect(names.get(NATIVE)).toBe("TimerStart");
  expect(luaStack(memory, L, names).map(frameText)).toEqual(["TimerStart", "map-1-2:150 (function at map-1-2:148)"]);
});

test("a code callback's birth names where its Lua function was defined; logs keep it", () => {
  const memory = new SparseMemory();
  const H = 0x30000000;
  memory.region(H, 0x1000);
  const FUNC = H, CLOSURE = H + 0x100, PROTO = H + 0x200, SOURCE = H + 0x300;
  memory.u64(FUNC + 0x18, CLOSURE);
  memory.text(CLOSURE + 8, "\x06");
  memory.u64(CLOSURE + 24, PROTO);
  memory.i32(PROTO + 40, 23999);
  memory.u64(PROTO + 104, SOURCE);
  memory.text(SOURCE + 8, "\x04");
  memory.text(SOURCE + 11, String.fromCharCode(20));
  memory.text(SOURCE + 24, "@map-1504344-3666443");
  expect(scriptFuncDefinition(memory, FUNC, [0x18])).toBe("map-1504344-3666443:23999");
  expect(scriptFuncDefinition(memory, FUNC, undefined)).toBeUndefined();
  expect(scriptFuncDefinition(memory, FUNC, [0x20])).toBeUndefined();
  const [event] = parsePresenceLog("1.250 born 6279 tag 4210 CAgentBaseAbs owner CScriptFunc at map-1504344-3666443:23999");
  expect(event).toMatchObject({ birth: 6279, owner: "CScriptFunc", defined: "map-1504344-3666443:23999" });
});

test("stopWatch stops the writing thread at each write and lets it go", async () => {
  const child = Bun.spawn([process.execPath, join(fixtures, "writer.ts")], { stdout: "pipe" });
  const { value } = await child.stdout.getReader().read();
  const address = Number(new TextDecoder().decode(value).trim());
  await Bun.sleep(200);
  const memory = procMemory(child.pid);
  const values: number[] = [];
  const hits = stopWatch({ tid: child.pid, address, seconds: 3, limit: 5, onHit: () => values.push(memory.read(address, 4).readInt32LE(0)) });
  memory.close();
  expect(hits).toBe(5);
  // Each stop lands right after one write.
  expect(values.slice(1).map((v, index) => v - (values[index] ?? 0))).toEqual([1, 1, 1, 1]);
  expect(await child.exited).toBe(0);
}, 10_000);
