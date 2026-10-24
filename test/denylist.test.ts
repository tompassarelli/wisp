import { expect, test } from "bun:test";
import { denylistDecision, denylistState } from "../host/checks/denylist";

const combined = (...statuses: { context: string; state: string }[]) => ({ state: "pending", statuses });

test("[spec tompassarelli/north#131] Autoland tests a claude/ tip only after its denylist status is success, refuses it on failure and holds it while missing or pending", () => {
  expect(denylistDecision(denylistState(combined({ context: "denylist", state: "success" })))).toEqual({ action: "test" });
  expect(denylistDecision(denylistState(combined({ context: "autoland", state: "pending" }, { context: "denylist", state: "failure" })))).toEqual({
    action: "refuse",
    state: "failure",
    description: "deny-list refused: reword and push again",
  });
  const hold = { action: "hold", state: "pending", description: "waiting for the deny-list attestation" };
  expect(denylistDecision(denylistState(combined({ context: "denylist", state: "pending" })))).toEqual(hold);
  expect(denylistDecision(denylistState(combined()))).toEqual(hold);
  expect(denylistDecision(denylistState(combined({ context: "autoland", state: "success" })))).toEqual(hold);
  expect(denylistDecision(denylistState(undefined))).toEqual(hold);
});
