// Runs the sample's registered tests in Lua.
import { runTests } from "wisp/src/runtime/testing";
import "../src/path.tests";

if (runTests(print) > 0) os.exit(1);
