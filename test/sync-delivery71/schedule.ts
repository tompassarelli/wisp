import { MEASURED_BATTLE_NET, MEASURED_TURN_BURSTS, syncDelivery, turnBursts } from "../../src/headless/syncChannel";
import { turnStart } from "../../src/headless/frameRate";
import { floorMod } from "../../src/sim/intMath";

export const SEND_FRAMES: readonly number[] = Array.from({ length: 120 }, (_, index) => 1 + index * 3 + floorMod(index * 7, 5) * 2);

export function scheduleRows(): string[] {
  const delivery = syncDelivery(MEASURED_BATTLE_NET, 1);
  const timing = turnBursts(MEASURED_TURN_BURSTS, 1);
  return SEND_FRAMES.map((frame, index) => {
    const sender = floorMod(index, 2);
    const arrival = delivery.arrivalFrame(sender, frame, { sender, prefix: "S", data: "" });
    return `${index} sender ${sender} sent ${frame} arrives ${arrival} turn ${turnStart(timing, arrival)}`;
  });
}
