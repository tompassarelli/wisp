import type { Events } from "../events";
import { asHandle, fromHandle } from "./types";
import { boundWorld } from "./world";

export function createEvents(): Events {
  const world = boundWorld();
  world.log?.("CreateTrigger", []);
  return fromHandle<Events>(world.events.create());
}

export function onEvents(events: Events, handler: (this: void) => void): void {
  const world = boundWorld();
  world.log?.("TriggerAddAction", [events, handler]);
  world.events.addAction(asHandle(events), handler);
}

export function destroyEvents(events: Events): void {
  const world = boundWorld();
  world.log?.("DestroyTrigger", [events]);
  world.events.destroy(asHandle(events));
}
