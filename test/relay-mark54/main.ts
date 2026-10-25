import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/map/fileio";

const PREFIX = "WISP_RLY";
const SLOTS = 24;

export function install(this: void): void {
  configureRuntime({ filePrefix: "relay-mark54", readyPrefix: "RM54_HRR", globalPrefix: "__relayMark54" });
}

function show(this: void, text: string, seconds: number): void {
  DisplayTimedTextToPlayer(GetLocalPlayer(), 0, 0, seconds, text);
}

export function start(this: void): void {
  install();
  const local = GetPlayerId(GetLocalPlayer());
  const clock = CreateTimer();
  TimerStart(clock, 100000.0, false, () => {});
  const events: string[] = [];
  const trigger = CreateTrigger();
  for (let slot = 0; slot < SLOTS; slot++) BlzTriggerRegisterPlayerSyncEvent(trigger, Player(slot), PREFIX, false);
  TriggerAddAction(trigger, () => {
    const line = `wisp54 sync player=${GetPlayerId(GetTriggerPlayer())} prefix=${BlzGetTriggerSyncPrefix()} data=${BlzGetTriggerSyncData()} time=${R2S(TimerGetElapsed(clock))}`;
    events.push(line);
    show(line, 600.0);
    writeLines(`relay-mark54-p${local}-event${events.length}.txt`, [`local=${local}`, ...events]);
  });
  show(`wisp54 ready local=${local}`, 600.0);
  TimerStart(CreateTimer(), 5.0, true, () => {
    const tick = R2I(TimerGetElapsed(clock));
    if (events.length === 0) show(`wisp54 no WISP_RLY yet time=${tick}`, 4.5);
    writeLines(`relay-mark54-p${local}-t${tick}.txt`, [`local=${local}`, `events=${events.length}`, ...events]);
  });
}
