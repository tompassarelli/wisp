import { expect } from "bun:test";
import { join } from "node:path";
import { mapCompiler, report } from "../host/toolchain/compiler";
import { farmTest } from "../host/farm/farmTest";
import { WARCRAFT3_NATIVES } from "../src/headless/warcraft3Natives";
import { EXPECTED as ANIMATION, EXPECTED_FILE as ANIMATION_FILE } from "./animation58/expected";
import { DEATH_TIMELINE, EXPECTED as EFFECTS } from "./effects59/expected";
import { EXPECTED as SCRIPT_RULES, EXPECTED_SYNC as SCRIPT_RULES_SYNC } from "./script-rules50/expected";
import { NATIVE_ROWS as SHADOW_STRIKE } from "./shadow-strike94/native-rows";
import { EXPECTED as SOUNDS } from "./sounds60/expected";
import { EXPECTED as TIMERS } from "./timers56/expected";
import { EXPECTED as PLAYER_MOUSE } from "./player-mouse67/expected";
import { EXPECTED as UNIT_MOTION } from "./unit-motion57/expected";
import { EXPECTED as UNIT_STATES } from "./unit-states/expected";
import { EXPECTED as UNIT_MOVEMENT } from "./unit-movement61/expected";
import { EFFECT_ORDER_ROWS } from "./effects59/order";
import { TIMER134_ROWS } from "./timer134/native";
import { scheduleRows } from "./sync-delivery71/schedule";

// Every headless fixture's emitted 32-bit Lua in one shared run: each fixture's rows equal its expected rows.
const root = join(import.meta.dir, "..");
const declarations = join(root, "src/natives/warcraft.d.ts");
const bothClients = (rows: readonly string[]) => [0, 1].flatMap(slot => rows.map(row => `p${slot} ${row}`));

const FIXTURES: readonly { readonly name: string; readonly title?: string; readonly map?: string; readonly rows: () => readonly string[] }[] = [
  { name: "warcraft3", title: "[reference] every 3.0 and 3.0.1 added native runs in its warcraft3 fixture in emitted 32-bit Lua with no unmodelled call", rows: () => WARCRAFT3_NATIVES },
  { name: "sync-delivery", rows: scheduleRows },
  { name: "coverage", rows: () => ["native coverage contract passed"] },
  { name: "standalone-profile", rows: () => ["p0 frame 0: native GetRandomReal is outside the standalone profile", "problems 1", "undeclared profile native refused"] },
  { name: "unit-states", map: "unit-states", rows: () => bothClients(UNIT_STATES) },
  { name: "unit-motion", map: "unit-motion57", rows: () => bothClients(UNIT_MOTION) },
  { name: "unit-movement", map: "unit-movement61", rows: () => bothClients(UNIT_MOVEMENT) },
  { name: "timers", map: "timers56", rows: () => bothClients(TIMERS) },
  { name: "timer134", map: "timer134", rows: () => TIMER134_ROWS,
    title: "[native wisp#134, timer134-a/b, 3.0.0.24268] TimerGetElapsed inside 1/60 s and 1/1024 s callbacks in emitted 32-bit Lua matches native's deadlines except a pinned 280-reading residual from callback 3,364" },
  { name: "player-mouse", map: "player-mouse67", rows: () => bothClients(PLAYER_MOUSE) },
  { name: "sounds", map: "sounds60", rows: () => bothClients(SOUNDS) },
  { name: "script-rules", map: "script-rules50", rows: () => bothClients([...SCRIPT_RULES, ...SCRIPT_RULES_SYNC]) },
  { name: "shadow-strike", map: "shadow-strike94", rows: () => bothClients(SHADOW_STRIKE.flat()) },
  { name: "effects", map: "effects59", rows: () => [...bothClients(EFFECTS), ...DEATH_TIMELINE] },
  { name: "effect-order", map: "effects59", rows: () => EFFECT_ORDER_ROWS,
    title: "[reference] a yaw, pitch, roll or orientation set after an effect's matrix scale resets it in emitted 32-bit Lua; the opposite order keeps it (#118)" },
  { name: "animation", map: "animation58", rows: () => bothClients([...ANIMATION_FILE, ...ANIMATION]) },
];

// The first test compiles the runner and every map and runs them all in one Lua32 process; each test reads its fixture's rows.
let shared: { compiled: string; code: number; stderr: string; rows: Map<string, string[]> } | undefined;
const run = () => {
  const compiled = [...new Set(["test/lua32-fixtures/tsconfig.json", ...FIXTURES.flatMap(fixture => fixture.map === undefined ? [] : [`test/${fixture.map}/tsconfig.json`])])]
    .map(config => report(mapCompiler(join(root, config))())).join("");
  if (compiled !== "") return { compiled, code: -1, stderr: "", rows: new Map<string, string[]>() };
  const args = FIXTURES.map(fixture => `${fixture.name}=${fixture.map === undefined ? "" : join(root, `build/${fixture.map}/map.lua`)}`);
  const lua = Bun.spawnSync([process.env.LUA ?? "lua", join(root, "build/lua32-fixtures/fixtures.lua"), declarations, ...args], { stdout: "pipe", stderr: "pipe" });
  const rows = new Map<string, string[]>();
  for (const line of lua.stdout.toString().trimEnd().split("\n")) {
    const space = line.indexOf(" ");
    const name = line.slice(0, space);
    rows.set(name, [...rows.get(name) ?? [], line.slice(space + 1)]);
  }
  return { compiled, code: lua.exitCode, stderr: lua.stderr.toString(), rows };
};

for (const fixture of FIXTURES) {
  farmTest(fixture.title ?? `[reference] ${fixture.name} rows in emitted 32-bit Lua equal its expected rows`, { timeout: 120_000 }, () => {
    shared ??= run();
    expect({ compiled: shared.compiled, code: shared.code, stderr: shared.stderr }).toEqual({ compiled: "", code: 0, stderr: "" });
    expect(shared.rows.get(fixture.name) ?? []).toEqual([...fixture.rows()]);
  });
}
