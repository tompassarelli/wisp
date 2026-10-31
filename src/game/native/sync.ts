import type { Events } from "../events";
import type { Player } from "../players";
import { SYNC_LIMIT } from "./syncStore";
import { asHandle, asNumber } from "./types";
import { boundWorld } from "./world";

export function sendSync(prefix: string, data: string): boolean {
  if (data.length > SYNC_LIMIT) throw new Error(`a sync message carries at most ${SYNC_LIMIT} characters, not ${data.length}`);
  const world = boundWorld();
  world.log?.("BlzSendSyncData", [prefix, data]);
  return world.sync.send(prefix, data);
}

export function addSyncEvent(events: Events, player: Player, prefix: string): void {
  const world = boundWorld();
  world.log?.("BlzTriggerRegisterPlayerSyncEvent", [events, player, prefix, false]);
  world.events.registerSync(asHandle(events), asNumber(player), prefix);
}

export function syncData(): string {
  const world = boundWorld();
  world.log?.("BlzGetTriggerSyncData", []);
  return world.events.syncData();
}

export function syncPrefix(): string {
  const world = boundWorld();
  world.log?.("BlzGetTriggerSyncPrefix", []);
  return world.events.syncPrefix();
}
