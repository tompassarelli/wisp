import { configureRuntime } from "../../src/runtime/config";
import { installDispatch, on, trampoline } from "../../src/platform/dispatch";

interface SoakTestState {
  tick: number;
  frozen: boolean;
  desync: boolean;
  throwing: boolean;
  heavyMs: number;

  readonly edges: number[];

  readonly keys: number[];
}

declare global {
  var __soakTest: SoakTestState | undefined;
}

export const state = (): SoakTestState => {
  const current = globalThis.__soakTest;
  if (current === undefined) throw new Error("soak test map not started");
  return current;
};

export const LAST_TICK = 300;

function tick(): void {
  const s = state();
  if (s.frozen && s.tick >= 90) return;
  s.tick++;
  if (s.desync && s.tick === 120 && GetPlayerId(GetLocalPlayer()) === 1) CreateTimer();
  if (s.throwing && s.tick === 150) throw new Error("tick 150 failed");
  const until = performance.now() + s.heavyMs;
  while (performance.now() < until) {

  }
}

function key(): void {
  const keys = state().keys;
  const player = GetPlayerId(GetTriggerPlayer());
  keys[player] = (keys[player] ?? 0) + 1;
}

export function install(): void {
  configureRuntime({ filePrefix: "soaktest", readyPrefix: "ST_HRR", globalPrefix: "__soakTest" });
  installDispatch();
  on("soak.tick", tick);
  on("soak.key", key);
}

export function start(): void {
  install();
  globalThis.__soakTest = { tick: 0, frozen: false, desync: false, throwing: false, heavyMs: 0, edges: [0, 0], keys: [0, 0] };
  TimerStart(CreateTimer(), 1 / 60, true, trampoline("soak.tick"));
  const typing = CreateTrigger();
  for (let player = 0; player < 2; player++) BlzTriggerRegisterPlayerKeyEvent(typing, Player(player), ConvertOsKeyType(0x41), 0, true);
  TriggerAddAction(typing, trampoline("soak.key"));
}
