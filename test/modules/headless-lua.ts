





import type { Lockstep } from "../../src/headless/lockstep";
import { luaLockstep } from "../../src/headless/lua";
import { ackFile, deltaFile, payloadFile } from "../../src/runtime/gameFiles";
import { type ModuleSet, parsePayload } from "../../src/runtime/modules";

declare const arg: Readonly<Record<number, string | undefined>>;

const MAP = { filePrefix: "mods" };

function read(path: string | undefined): string {
  if (path === undefined) throw "usage: lua modules.lua MAP_LUA WARCRAFT_D_TS V1 V2 V3";
  const [file, problem] = io.open(path, "rb");
  if (file === undefined) throw `can't read ${path}: ${problem}`;
  const text = file.read("a") ?? "";
  file.close();
  return text;
}

function moduleSet(text: string): ModuleSet {
  const payload = parsePayload(text);
  if (payload === undefined) throw "a version file is not a payload";
  return { entry: payload.entry, modules: payload.hashes.map(([name]) => ({ name, text: payload.texts[name] ?? "" })) };
}

function check(condition: boolean, message: string): void {
  if (!condition) throw message;
}

const bundle = read(arg[1]);
const declarations = read(arg[2]);
const versions = [moduleSet(read(arg[3])), moduleSet(read(arg[4])), moduleSet(read(arg[5]))];
const [v1, v2, v3] = versions;
if (v1 === undefined || v2 === undefined || v3 === undefined) throw "three versions";


interface HotView {
  applied: number;
  state?: string;
  modules?: Record<string, { readonly hash: string } | undefined>;
}

function hot(clients: Lockstep, index: number): HotView {
  const view: unknown = clients.clients[index]?.natives.__modsHot;
  if (typeof view !== "object" || view === null) throw `p${index} has no reloader`;
  return view as HotView;
}


function installed(clients: Lockstep, index: number): string {
  const lines: string[] = [];
  const modules = hot(clients, index).modules ?? {};
  for (const name of Object.keys(modules)) lines.push(`${name} ${modules[name]?.hash}`);
  return lines.sort().join("\n");
}


function readPayload(clients: Lockstep, index: number): string {
  const files = clients.files;
  const client = clients.clients[index];
  if (files === undefined || client === undefined) return "none";
  const { state, base } = files.manifest;
  const read = client.preloadedFiles();
  const delta = read.includes(deltaFile(state, base, 0, MAP.filePrefix));
  const full = read.includes(payloadFile(state, 0, MAP.filePrefix));
  return delta && full ? "both" : delta ? "delta" : full ? "full" : "none";
}

function started(): Lockstep {
  const clients = luaLockstep(MAP, bundle, declarations);
  clients.start();
  clients.frames(10);
  return clients;
}


function reload(clients: Lockstep, modules: ModuleSet): void {
  clients.reload(modules);
  clients.frames(6);
}

function agree(clients: Lockstep, scenario: string): void {
  clients.frames(60);
  check(clients.firstDivergence() === undefined, `${scenario}: ${clients.firstDivergence()}`);
  const [first, second] = clients.clients;
  check(first !== undefined && second !== undefined && first.checksum() === second.checksum(), `${scenario}: checksums differ`);
  check(installed(clients, 0) === installed(clients, 1), `${scenario}: installed modules differ`);
  check(hot(clients, 0).state === hot(clients, 1).state, `${scenario}: states differ`);
  for (const client of clients.clients) check(client.errors.length === 0, `${scenario}: p${client.slot} ${client.errors.join("; ")}`);
}

function applied(clients: Lockstep, scenario: string, version: number, path: string): void {
  check(clients.unappliedReloads().length === 0, `${scenario}: ${clients.unappliedReloads().join("; ")}`);
  const acknowledgements: string[] = [];
  for (let index = 0; index < 2; index++) {
    check(readPayload(clients, index) === path, `${scenario} v${version}: p${index} read ${readPayload(clients, index)}, not ${path}`);
    check(hot(clients, index).applied === version, `${scenario}: p${index} runs v${hot(clients, index).applied}`);
    acknowledgements.push(clients.clients[index]?.files.get(ackFile(index, MAP.filePrefix))?.[0] ?? "");
  }
  check(acknowledgements[0] === acknowledgements[1], `${scenario}: installed on different frames: ${acknowledgements.join(" / ")}`);
}


const incremental = started();
reload(incremental, v1);
applied(incremental, "incremental", 1, "full");
reload(incremental, v2);
applied(incremental, "incremental", 2, "delta");
const changed = incremental.files;
reload(incremental, v3);
applied(incremental, "incremental", 3, "delta");
const renamed = incremental.files;
agree(incremental, "incremental");


const full = started();
reload(full, v3);
applied(full, "full", 1, "full");
agree(full, "full");
check(installed(full, 0) === installed(incremental, 0), "full and incremental reloads installed different modules");
check(hot(full, 0).state === hot(incremental, 0).state, "full and incremental reloads ended in different states");


const mixed = started();
reload(mixed, v1);
delete hot(mixed, 1).modules;
reload(mixed, v2);
check(readPayload(mixed, 0) === "delta" && readPayload(mixed, 1) === "full", `mixed: p0 read ${readPayload(mixed, 0)}, p1 ${readPayload(mixed, 1)}`);
check(mixed.unappliedReloads().length === 0, `mixed: ${mixed.unappliedReloads().join("; ")}`);
agree(mixed, "mixed");
check(hot(mixed, 0).state === mixed.files?.manifest.state, "mixed: the clients don't run the version's state");


const mismatch = started();
reload(mismatch, v1);
const before = hot(mismatch, 0).state;
mismatch.reload(v2);
const files = mismatch.files;
if (files === undefined) throw "mismatch: nothing published";
const deltaName = deltaFile(files.manifest.state, files.manifest.base, 0, MAP.filePrefix);
const delta = mismatch.clients[1]?.published.get(deltaName)?.[0] ?? "";
mismatch.clients[1]?.published.set(deltaName, [`${delta.slice(0, delta.length - 3)}x${delta.slice(delta.length - 2)}`]);
mismatch.frames(6);
check(mismatch.unappliedReloads().length === 2, "mismatch: a damaged version was installed");
const lastMessage = (index: number) => {
  const messages = mismatch.clients[index]?.messages ?? [];
  return messages[messages.length - 1] ?? "";
};
check(lastMessage(0) === "hot reload 2 not applied: another client couldn't load it", `mismatch: p0 said ${lastMessage(0)}`);
check(lastMessage(1).startsWith("hot reload 2 not applied: module ") && lastMessage(1).endsWith(" damaged"), `mismatch: p1 said ${lastMessage(1)}`);
check(hot(mismatch, 0).state === before && hot(mismatch, 1).state === before, "mismatch: a client left the installed state");
agree(mismatch, "mismatch");


const missing = started();
reload(missing, v1);
const kept = v3.modules.filter(({ name }) => !name.endsWith("caption"));
check(kept.length === v3.modules.length - 1, "missing: v3 has a caption module");
reload(missing, { entry: v3.entry, modules: kept });
check(missing.unappliedReloads().length === 2, "missing: a version without a required module was installed");
for (let index = 0; index < 2; index++) {
  const messages = missing.clients[index]?.messages ?? [];
  const message = messages[messages.length - 1] ?? "";
  check(message.includes("not applied: failed while loading:") && message.includes("caption' not found"), `missing: p${index} said ${message}`);
}
agree(missing, "missing");

print(`full payload ${changed?.fullBytes} bytes; a changed module's delta ${changed?.changedBytes} bytes (${changed?.changed.join(", ")})`);
print(`renamed and deleted modules' delta ${renamed?.changedBytes} bytes (${renamed?.changed.join(", ")})`);
print(`installed ${installed(incremental, 0).split("\n").length} modules, state ${hot(incremental, 0).state}`);
print("module reload contract passed");
