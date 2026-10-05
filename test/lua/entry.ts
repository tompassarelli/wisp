// Runs every registered test in Lua; the index imports the test modules.
import { runTests } from "../../src/runtime/testing";
import "./index";

if (runTests(print) > 0) os.exit(1);
