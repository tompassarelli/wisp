// Runs every registered test in Lua, or those whose names, after their oracle
// tag, start with the script's first argument; the index imports the test modules.
import { registeredTests, runTests } from "../../src/runtime/testing";
import "./index";

/** The standalone Lua interpreter's script arguments. */
declare const arg: readonly (string | undefined)[];

/** A test's name without its leading oracle tag. */
function untagged(name: string): string {
  const end = name.indexOf("] ");
  return name.startsWith("[") && end !== -1 ? name.slice(end + 2) : name;
}

const only = arg[0];
if (only !== undefined) {
  const chosen = registeredTests.filter(({ name }) => untagged(name).startsWith(only));
  registeredTests.length = 0;
  registeredTests.push(...chosen);
}
if (runTests(print) > 0) os.exit(1);
