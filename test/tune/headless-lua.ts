





import { luaLockstep } from "../../src/headless/lua";
import { type ModuleSet, parsePayload } from "../../src/runtime/modules";

declare const arg: Readonly<Record<number, string | undefined>>;

function read(path: string | undefined): string {
  if (path === undefined) throw "usage: lua tune.lua MAP_LUA WARCRAFT_D_TS UNTUNED TUNED";
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


interface Fixture {
  readonly ticks: number;
  readonly steps: number[];
  readonly installs: number[];
}

const clients = luaLockstep({ filePrefix: "tune" }, read(arg[1]), read(arg[2]));
const fixture = (index: number): Fixture => {
  const state: unknown = clients.clients[index]?.natives.__tuneFixture;
  if (typeof state !== "object" || state === null) throw `p${index} has no fixture state`;
  return state as Fixture;
};

clients.start();
clients.frames(10);
clients.reload(moduleSet(read(arg[3])));
clients.frames(6);
check(clients.unappliedReloads().length === 0, `untuned: ${clients.unappliedReloads().join("; ")}`);
clients.frames(10);
clients.reload(moduleSet(read(arg[4])));
clients.frames(6);
check(clients.unappliedReloads().length === 0, `tuned: ${clients.unappliedReloads().join("; ")}`);
const tuned = clients.files;
check(tuned !== undefined && tuned.changed.length === 1, `the tuned version carries ${tuned?.changed.join(", ")}`);
clients.frames(30);

check(clients.firstDivergence() === undefined, `${clients.firstDivergence()}`);
const [first, second] = clients.clients;
check(first !== undefined && second !== undefined && first.checksum() === second.checksum(), "the clients' checksums differ");
for (const client of clients.clients) check(client.errors.length === 0, `p${client.slot}: ${client.errors.join("; ")}`);
const [p0, p1] = [fixture(0), fixture(1)];
check(p0.installs.join(" ") === p1.installs.join(" "), `installed on different ticks: ${p0.installs.join(" ")} / ${p1.installs.join(" ")}`);
check(p0.steps.join(" ") === p1.steps.join(" "), "the clients took different steps");
const at = p0.installs[1];
if (at === undefined || at <= 0 || at >= p0.ticks) throw `the tuned version installed at tick ${at} of ${p0.ticks}`;
const before = p0.steps[at - 1] ?? 0.0;
const after = p0.steps[at] ?? 0.0;
for (let tick = 0; tick < p0.ticks; tick++) check(p0.steps[tick] === (tick < at ? before : after), `tick ${tick} stepped ${p0.steps[tick]}`);
check(before !== after, "the tuned value changed no step");
print(`tuned module ${tuned?.changed.join(", ")}, delta ${tuned?.changedBytes} of ${tuned?.fullBytes} bytes`);
print(`both clients installed the tuned version at tick ${at}; step before ${string.format("%.9g", before)}, after ${string.format("%.9g", after)}`);
print("tune contract passed");
