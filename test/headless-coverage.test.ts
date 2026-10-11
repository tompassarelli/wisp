import { expect, test } from "bun:test";
import { coverageFixture } from "./coverage/fixture";

test("equal defaults fail coverage, modeled and intentional calls pass in Bun", coverageFixture);
