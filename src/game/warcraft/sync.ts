import type { Lowering } from "./lowering";

export const sync: Lowering = {
  sendSync: "BlzSendSyncData($1, $2)",
  addSyncEvent: "BlzTriggerRegisterPlayerSyncEvent($1, $2, $3, false)",
  syncData: "BlzGetTriggerSyncData()",
  syncPrefix: "BlzGetTriggerSyncPrefix()",
};
