// A map with the frame meter: each 60 Hz frame calls GetUnitX `__fixtureWork`
// times and advances its simulation one frame, or `__fixtureCatchUp` frames once.
import { configureRuntime } from "../../src/runtime/config";
import { installDispatch, on, trampoline } from "../../src/platform/dispatch";
import { installFrameMeter, startFrameMeter } from "../../src/platform/frameMeter";
import { installHotReload, startHotReload } from "../../src/platform/hotReload";

interface FixtureState {
  readonly unit: unit;
  work: number;
  simulation: number;
  catchUp: number;
}

declare global {
  var __fixtureState: FixtureState | undefined;
}

function state(): FixtureState {
  const current = globalThis.__fixtureState;
  if (current === undefined) throw new Error("fixture state used before start");
  return current;
}

function frame(): void {
  const fixture = state();
  for (let call = 0; call < fixture.work; call++) GetUnitX(fixture.unit);
  fixture.simulation += fixture.catchUp;
  fixture.catchUp = 1;
}

function command(): void {
  const fixture = state();
  const [name, value] = GetEventPlayerChatString().split(" ");
  if (name === "-work") fixture.work = S2I(value ?? "0");
  else if (name === "-stall") fixture.catchUp = S2I(value ?? "1");
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "meter", readyPrefix: "MT_HRR", globalPrefix: "__fixture" });
  installDispatch();
  on("fixture.frame", frame);
  on("fixture.command", command);
  installHotReload();
  installFrameMeter();
}

export function start(this: void): void {
  install();
  globalThis.__fixtureState = { unit: CreateUnit(Player(0), 0x68666f6f, 0.0, 0.0, 0.0), work: 10, simulation: 0, catchUp: 1 };
  TimerStart(CreateTimer(), 1.0 / 60.0, true, trampoline("fixture.frame"));
  const chat = CreateTrigger();
  for (const player of [0, 1]) {
    TriggerRegisterPlayerChatEvent(chat, Player(player), "-work ", false);
    TriggerRegisterPlayerChatEvent(chat, Player(player), "-stall ", false);
  }
  TriggerAddAction(chat, trampoline("fixture.command"));
  startHotReload();
  startFrameMeter({ frame: "fixture.frame", simulationFrame: () => state().simulation, toggle: "-perf" });
}
