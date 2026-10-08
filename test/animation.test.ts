// Animation playback rules (wisp:src/headless/animation.tests.ts) in Bun; runtime.test.ts runs them in 32-bit Lua.
import { test } from "bun:test";
import { registeredTests } from "../src/runtime/testing";

// Taken out of the shared registry, which other files of this process count.
const registered = registeredTests.length;
await import("../src/headless/animation.tests");
for (const rule of registeredTests.splice(registered)) test(rule.name, rule.run);
