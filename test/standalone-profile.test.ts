import { expect, test } from "bun:test";
import { standaloneProfile } from "../host/headless/standaloneProfile";
import { parseNativeDeclarations } from "../src/headless/declarations";

test("the standalone profile of a bundle lists the declared natives its text calls, not the ones it only names in a string", () => {
  const declarations = parseNativeDeclarations(`
declare function CreateTimer(this: void): timer;
declare function GetRandomReal(this: void, low: number, high: number): number;
`);
  expect(standaloneProfile("local t = CreateTimer()\nprint(\"GetRandomInt\")", declarations)).toEqual(["CreateTimer"]);
});
