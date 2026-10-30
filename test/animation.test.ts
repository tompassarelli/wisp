import { test } from "bun:test";
import { registeredTests } from "../src/runtime/testing";

const registered = registeredTests.length;
await import("../src/game/native/animation.tests");
for (const rule of registeredTests.splice(registered)) test(rule.name, rule.run);
