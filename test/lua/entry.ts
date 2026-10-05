// Runs every registered test in Lua; the index imports the test modules.
import { AssertionFailure, registeredTests } from "../../src/runtime/testing";
import "./index";

let failures = 0;
for (const { name, run } of registeredTests) {
  try {
    run();
  } catch (error) {
    failures++;
    print(`fail ${name}: ${error instanceof AssertionFailure ? error.message : String(error)}`);
  }
}
print(`${registeredTests.length - failures} of ${registeredTests.length} passed`);
if (failures > 0) os.exit(1);
