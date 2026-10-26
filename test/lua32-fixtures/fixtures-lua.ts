import type { Lockstep } from "../../src/headless/lockstep";
import { parseNativeDeclarations } from "../../src/headless/declarations";
import { runJourney } from "../../src/headless/journey";
import { luaLockstep, readFile } from "../../src/headless/lua";
import { MEASURED_BATTLE_NET, syncDelivery } from "../../src/headless/syncChannel";
import { allWarcraft3Fixtures } from "../warcraft3-core/all";
import { coverageFixture } from "../coverage/fixture";
import { UNIT_FIXTURE } from "../unit-states/cases";
import { UNIT_MOTION_NOOPS } from "../unit-motion57/cases";
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
    return [...executed].sort();
  },
  "sync-delivery": () => scheduleRows(),
  "coverage": () => {
    coverageFixture();
    return ["native coverage contract passed"];
  },
  "unit-states": bundle => {
    const clients = played(luaLockstep({ filePrefix: "unit-states", unitStates: UNIT_FIXTURE }, bundle, declarations), 80);
    return diverged(clients, files(clients, ["unit-states"]));
  },
  "unit-motion": bundle => {
    const clients = played(luaLockstep({ filePrefix: "unit-motion", intentionalNoops: UNIT_MOTION_NOOPS }, bundle, declarations), 150);
    return diverged(clients, files(clients, ["unit-motion"]));
  },
  "timers": bundle => {
    const clients = played(luaLockstep({ filePrefix: "timers56" }, bundle, declarations), 76);
    return diverged(clients, files(clients, ["timers56"]));
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
