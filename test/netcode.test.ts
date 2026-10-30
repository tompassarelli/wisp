import { describe, test } from "bun:test";
import { registeredTests } from "../src/runtime/testing";

const registered = registeredTests.length;
await import("../src/netcode/rowCodec.tests");
await import("../src/netcode/schedule.tests");
await import("../src/netcode/session.tests");
await import("../src/netcode/delay.tests");
const contracts = registeredTests.splice(registered);
describe("netcode contracts", () => {
  for (const contract of contracts) test(contract.name, contract.run);
});
