// Runs every registered test in Lua, or those whose names start with the
// script's first argument; the index imports the test modules.
import { registeredTests, runTests } from "../../src/runtime/testing";
import "./index";

/** The standalone Lua interpreter's script arguments. */
declare const arg: readonly (string | undefined)[];

const only = arg[0];
if (only !== undefined) {
  const chosen = registeredTests.filter(({ name }) => name.startsWith(only));
  registeredTests.length = 0;
  registeredTests.push(...chosen);
}
if (runTests(print) > 0) os.exit(1);
