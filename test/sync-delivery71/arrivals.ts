import { turnStart } from "../../src/headless/frameRate";
import { MEASURED_BATTLE_NET, MEASURED_TURN_BURSTS, syncDelivery, turnBursts } from "../../src/headless/syncChannel";
import { floorMod } from "../../src/sim/intMath";

// One fixed send schedule through measured Battle.net delivery and turn bursts: each message's delivery frame and the turn-start frame lockstep lands it on (wisp#71).
export function deliveryRows(): string[] {
  const delivery = syncDelivery(MEASURED_BATTLE_NET, 71);
  const callbacks = turnBursts(MEASURED_TURN_BURSTS, 71);
  const rows: string[] = [];
  for (let frame = 1; frame <= 600; frame++) {
    for (const [sender, every] of [[0, 2], [1, 3]] as const) {
      if (floorMod(frame, every) !== 0) continue;
      const delivered = delivery.arrivalFrame(sender, frame, { sender, prefix: "P", data: "" });
      rows.push(`sender=${sender} sent=${frame} delivered=${delivered} turn=${turnStart(callbacks, delivered)}`);
    }
  }
  return rows;
}
