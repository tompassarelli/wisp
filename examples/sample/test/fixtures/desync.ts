// An intentionally broken sample for CI's failing-fixture check
// (wisp:docs/ci.md): the first player's client alone creates an extra unit,
// so the two clients' synchronized state diverges and the headless journey
// must report a desync.
import { install, start as sampleStart } from "../../src/main";

export { install };

export function start(this: void): void {
  sampleStart();
  if (GetLocalPlayer() === Player(0)) CreateUnit(Player(0), 0x68666f6f, 0.0, 0.0, 270.0);
}
