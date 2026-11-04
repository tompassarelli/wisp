import type { Lockstep } from "../../src/headless/lockstep";
import { parseNativeDeclarations } from "../../src/headless/declarations";
import { runJourney } from "../../src/headless/journey";
import { luaLockstep, readFile } from "../../src/headless/lua";
import { MEASURED_BATTLE_NET, syncDelivery } from "../../src/headless/syncChannel";
import { allWarcraft3Fixtures } from "../warcraft3-core/all";
import { coverageFixture } from "../coverage/fixture";
import { standaloneProfileRows } from "../coverage/profile";
import { UNIT_FIXTURE } from "../unit-states/cases";
import { UNIT_MOTION_NOOPS } from "../unit-motion57/cases";
import { UNIT_MOVEMENT_NOOPS } from "../unit-movement61/cases";
import { SOUND_NATIVES } from "../sounds60/cases";
import { SHADOW_CONFIGS, SHADOW_JOURNEY } from "../shadow-strike94/configs";
import { SHADOW_HEADLESS } from "../shadow-strike94/headless-config";
import { EFFECT_NOOPS } from "../effects59/cases";
import { EFFECT_DEATHS, deathTimeline } from "../effects59/deaths";
import { ANIMATION_NOOPS } from "../animation58/cases";
import { CAPTURE_FRAME, RULER, RULER_DEATH_SECONDS } from "../animation58/layout";
import { animationRows } from "../animation58/rows";
import { PLAYER_MOUSE_JOURNEY } from "../player-mouse67/journey";
import { scheduleRows } from "../sync-delivery71/schedule";
import { TIMER134_CALLBACKS, TIMER134_FAST_CALLBACKS } from "../timer134/main";
import { effectOrderRows } from "../effects59/order";
import { WARCRAFT3_NATIVES } from "../../src/headless/warcraft3Natives";

// One Lua32 run of every fixture in test/lua32-fixtures.test.ts: it prints each fixture's rows, prefixed by its name, for the test to compare.
declare const arg: Readonly<Record<number, string | undefined>>;
const declarationsPath = arg[1];
if (declarationsPath === undefined) throw new Error("usage: lua fixtures.lua WARCRAFT_D_TS FIXTURE=MAP_LUA...");
const declarations = readFile(declarationsPath);

const files = (clients: Lockstep, prefixes: readonly string[]) => clients.clients.flatMap(client =>
  prefixes.flatMap(prefix => (client.files.get(`${prefix}-p${client.slot}.txt`) ?? []).map(row => `p${client.slot} ${row}`)));
const played = (clients: Lockstep, frames: number) => {
  clients.start();
  clients.frames(frames);
  return clients;
};
const diverged = (clients: Lockstep, rows: string[]) => {
  const divergence = clients.firstDivergence();
  return divergence === undefined ? rows : [...rows, `divergence ${divergence}`];
};

const FIXTURES: Record<string, (this: void, bundle: string) => string[]> = {
  "warcraft3": () => {
    const executed = new Set<string>();
    allWarcraft3Fixtures(parseNativeDeclarations(declarations), executed);
    return WARCRAFT3_NATIVES.filter(name => executed.has(name));
  },
  "sync-delivery": () => scheduleRows(),
  "coverage": () => {
    coverageFixture();
    return ["native coverage contract passed"];
  },
  "standalone-profile": () => standaloneProfileRows(),
  "unit-states": bundle => {
    const clients = played(luaLockstep({ filePrefix: "unit-states", unitStates: UNIT_FIXTURE }, bundle, declarations), 80);
    return diverged(clients, files(clients, ["unit-states"]));
  },
  "unit-motion": bundle => {
    const clients = played(luaLockstep({ filePrefix: "unit-motion", intentionalNoops: UNIT_MOTION_NOOPS }, bundle, declarations), 150);
    return diverged(clients, files(clients, ["unit-motion"]));
  },
  "unit-movement": bundle => {
    const clients = played(luaLockstep({ filePrefix: "unit-movement", intentionalNoops: UNIT_MOVEMENT_NOOPS }, bundle, declarations), 5);
    return diverged(clients, files(clients, ["unit-movement"]));
  },
  "timers": bundle => {
    const clients = played(luaLockstep({ filePrefix: "timers56" }, bundle, declarations), 76);
    return diverged(clients, files(clients, ["timers56"]));
  },
  "timer134": bundle => {
    const clients = luaLockstep({ filePrefix: "timer134", players: [0] }, bundle, declarations);
    clients.start();
    const client = clients.clients[0];
    for (let frame = 0; frame < 2 * TIMER134_CALLBACKS && client?.files.get(`timer134-${TIMER134_CALLBACKS}-p0.txt`) === undefined; frame += 60) clients.frames(60);
    const chunks = (name: string, total: number) => Array.from({ length: Math.ceil(total / 100) }, (_, index) => Math.min(total, 100 * (index + 1)))
      .flatMap(count => client?.files.get(`${name}-${count}-p0.txt`) ?? [`missing ${name}-${count}`]);
    return [...chunks("timer134-fast", TIMER134_FAST_CALLBACKS).map(row => `fast ${row}`), ...chunks("timer134", TIMER134_CALLBACKS)];
  },
  "player-mouse": bundle => {
    const clients = luaLockstep({ filePrefix: "player-mouse67" }, bundle, declarations, undefined, syncDelivery(MEASURED_BATTLE_NET, 67));
    const result = runJourney(clients, PLAYER_MOUSE_JOURNEY);
    const problems = result.clients.flatMap(client => [...client.errors.map(error => `p${client.slot} error ${error}`), ...client.missingNatives.map(missing => `p${client.slot} unmodeled ${missing.native}`)]);
    return diverged(clients, [...files(clients, ["player-mouse67"]), ...problems]);
  },
  "sounds": bundle => {
    const clients = played(luaLockstep({ filePrefix: "sounds60", natives: SOUND_NATIVES }, bundle, declarations), 240);
    return diverged(clients, files(clients, ["sounds60"]));
  },
  "script-rules": bundle => {
    const clients = played(luaLockstep({ filePrefix: "script-rules" }, bundle, declarations), 150);
    const unmodeled = clients.clients.flatMap(client => client.missingNatives.map(missing => `p${client.slot} unmodeled ${missing.native}`));
    return diverged(clients, [...unmodeled, ...files(clients, ["script-rules", "script-rules-sync"])]);
  },
  "shadow-strike": bundle => {
    const clients = played(luaLockstep(SHADOW_HEADLESS, bundle, declarations), SHADOW_JOURNEY.frames);
    const problems = clients.clients.flatMap(client => [
      ...client.errors.map(error => `p${client.slot} error ${error}`),
      ...client.missingNatives.map(missing => `p${client.slot} unmodeled ${missing.native}`),
    ]);
    return diverged(clients, [...files(clients, SHADOW_CONFIGS.map(config => `shadow-strike94-${config.name}`)), ...problems]);
  },
  "effects": bundle => {
    const clients = luaLockstep({ filePrefix: "effects", intentionalNoops: EFFECT_NOOPS, effectDeaths: EFFECT_DEATHS }, bundle, declarations);
    const timeline = deathTimeline(clients);
    return diverged(clients, [...files(clients, ["effects"]), ...timeline]);
  },
  "effect-order": bundle => {
    const clients = luaLockstep({ filePrefix: "effects", intentionalNoops: EFFECT_NOOPS, effectDeaths: EFFECT_DEATHS, players: [0] }, bundle, declarations);
    clients.start();
    const client = clients.clients[0];
    return client === undefined ? ["no client"] : effectOrderRows(client);
  },
  "animation": bundle => {
    const effectDeaths = (model: string) => (model === RULER ? RULER_DEATH_SECONDS : undefined);
    const clients = played(luaLockstep({ filePrefix: "animation", intentionalNoops: ANIMATION_NOOPS, effectDeaths }, bundle, declarations), CAPTURE_FRAME);
    return diverged(clients, clients.clients.flatMap(client =>
      [...client.files.get(`animation-p${client.slot}.txt`) ?? [], ...animationRows(client.effectPoses(), client.unitPoses())].map(row => `p${client.slot} ${row}`)));
  },
};

// Each fixture runs even when an earlier one fails; its error becomes one of its rows.
for (let index = 2; arg[index] !== undefined; index++) {
  const [name, path] = (arg[index] ?? "").split("=");
  const run = name === undefined ? undefined : FIXTURES[name];
  if (name === undefined || run === undefined) throw new Error(`unknown fixture ${arg[index]}`);
  let rows: string[];
  try {
    rows = run(path === undefined || path === "" ? "" : readFile(path));
  } catch (error) {
    rows = [`error ${String(error)}`];
  }
  for (const row of rows) print(`${name} ${row}`);
}
