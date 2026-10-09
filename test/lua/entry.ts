

import { registeredTests, runTests } from "../../src/runtime/testing";
import "./index";


declare const arg: readonly (string | undefined)[];


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
