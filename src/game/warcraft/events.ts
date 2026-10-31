import type { Lowering } from "./lowering";

export const events: Lowering = {
  createEvents: "CreateTrigger()",
  onEvents: "TriggerAddAction($1, $2)",
  destroyEvents: "DestroyTrigger($1)",
};
