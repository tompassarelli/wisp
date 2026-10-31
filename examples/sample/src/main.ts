// The map's TypeScript entry. The map's main() calls start() once; every hot
// reload calls the new bundle's install(), which registers the handlers again.
// Timers and triggers made in start() keep calling them through trampolines.
import { abilityTooltip, bodyAbilityLevel, bodyName, createBody, mapCenterX, mapCenterY, setBodyAbilityLevel, setBodyX, setBodyY, type Body } from "wisp/game/bodies";
import { createTimer, startTimer } from "wisp/game/clock";
import { createEvents, onEvents } from "wisp/game/events";
import { displayTextToAll } from "wisp/game/frames";
import { addChatEvent } from "wisp/game/input";
import { player as playerAt } from "wisp/game/players";
import { configureRuntime } from "wisp/src/runtime/config";
import { at } from "wisp/src/runtime/lookup";
import { installDispatch, on, trampoline } from "wisp/src/map/dispatch";
import { installHotReload, startHotReload } from "wisp/src/map/hotReload";
import { f32 } from "wisp/src/sim/f32";
import { pathPoint } from "./path";
import { WALKER_ID, SNOW_ID } from "./objectIds";
import { writeLines } from "wisp/src/map/fileio";

const PLAYERS = 2;

/** Match state lives in a global, so a reloaded bundle continues it. */
interface SampleState {
  tick: number;
  pings: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly units: readonly Body[];
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
    setBodyX(unit, sample.centerX + point.x);
    setBodyY(unit, sample.centerY + point.y);
  }
}

function ping(): void {
  const sample = state();
  sample.pings++;
  displayTextToAll(`ping ${sample.pings}`);
}

function objects(): void {
  const lines: string[] = [];
  for (let player = 0; player < PLAYERS; player++) {
    const unit = at(state().units, player);
    const level = bodyAbilityLevel(unit, SNOW_ID);
    const line = `p${player}: ${bodyName(unit)}, ability level ${level}, ${abilityTooltip(SNOW_ID, level - 1)}`;
    lines.push(line);
    displayTextToAll(line);
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
  const centerX = mapCenterX();
  const centerY = mapCenterY();
  const units: Body[] = [];
  for (let player = 0; player < PLAYERS; player++) {
    const unit = createBody(playerAt(player), WALKER_ID, centerX, centerY, 270.0);
    setBodyAbilityLevel(unit, SNOW_ID, player + 1);
    units.push(unit);
  }
  globalThis.__sampleState = { tick: 0, pings: 0, centerX, centerY, units };
  startTimer(createTimer(), f32(0.1), true, trampoline("sample.move"));
  const chat = createEvents();
  for (let player = 0; player < PLAYERS; player++) addChatEvent(chat, playerAt(player), "-ping", true);
  onEvents(chat, trampoline("sample.ping"));
  const objectChat = createEvents();
  for (let player = 0; player < PLAYERS; player++) addChatEvent(objectChat, playerAt(player), "-objects", true);
  onEvents(objectChat, trampoline("sample.objects"));
  startHotReload();
}
