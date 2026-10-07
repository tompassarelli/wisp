// The map's TypeScript entry. The map's main() calls start() once; every hot
// reload calls the new bundle's install(), which registers the handlers again.
// Timers and triggers made in start() keep calling them through trampolines.
import { configureRuntime } from "wisp/src/runtime/config";
import { at } from "wisp/src/runtime/lookup";
import { installDispatch, on, trampoline } from "wisp/src/platform/dispatch";
import { installHotReload, startHotReload } from "wisp/src/platform/hotReload";
import { f32 } from "wisp/src/sim/f32";
import { pathPoint } from "./path";
import { WALKER_ID, SNOW_ID } from "./objectIds";
import { writeLines } from "wisp/src/platform/fileio";

const PLAYERS = 2;

/** Match state lives in a global, so a reloaded bundle continues it. */
interface SampleState {
  tick: number;
  pings: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly units: readonly unit[];
}

declare global {
  var __sampleState: SampleState | undefined;
}

function state(): SampleState {
  const current = globalThis.__sampleState;
  if (current === undefined) throw new Error("sample state used before start");
  return current;
}

function move(): void {
  const sample = state();
  sample.tick++;
  for (let player = 0; player < sample.units.length; player++) {
    const point = pathPoint(sample.tick, player);
    const unit = at(sample.units, player);
    SetUnitX(unit, sample.centerX + point.x);
    SetUnitY(unit, sample.centerY + point.y);
  }
}

function ping(): void {
  const sample = state();
  sample.pings++;
  DisplayTextToForce(GetPlayersAll(), `ping ${sample.pings}`);
}

function objects(): void {
  const lines: string[] = [];
  for (let player = 0; player < PLAYERS; player++) {
    const unit = at(state().units, player);
    const level = GetUnitAbilityLevel(unit, SNOW_ID);
    const line = `p${player}: ${GetUnitName(unit)}, ability level ${level}, ${BlzGetAbilityTooltip(SNOW_ID, level - 1)}`;
    lines.push(line);
    DisplayTextToForce(GetPlayersAll(), line);
  }
  writeLines("sample-objects.txt", lines);
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "sample", readyPrefix: "SP_HRR", globalPrefix: "__sample" });
  installDispatch();
  on("sample.move", move);
  on("sample.ping", ping);
  on("sample.objects", objects);
  installHotReload();
}

export function start(this: void): void {
  install();
  const centerX = GetRectCenterX(bj_mapInitialPlayableArea);
  const centerY = GetRectCenterY(bj_mapInitialPlayableArea);
  const units: unit[] = [];
  for (let player = 0; player < PLAYERS; player++) {
    const unit = CreateUnit(Player(player), WALKER_ID, centerX, centerY, 270.0);
    SetUnitAbilityLevel(unit, SNOW_ID, player + 1);
    units.push(unit);
  }
  globalThis.__sampleState = { tick: 0, pings: 0, centerX, centerY, units };
  TimerStart(CreateTimer(), f32(0.1), true, trampoline("sample.move"));
  const chat = CreateTrigger();
  for (let player = 0; player < PLAYERS; player++) TriggerRegisterPlayerChatEvent(chat, Player(player), "-ping", true);
  TriggerAddAction(chat, trampoline("sample.ping"));
  const objectChat = CreateTrigger();
  for (let player = 0; player < PLAYERS; player++) TriggerRegisterPlayerChatEvent(objectChat, Player(player), "-objects", true);
  TriggerAddAction(objectChat, trampoline("sample.objects"));
  startHotReload();
}
