import { expect, test } from "bun:test";
import { halves, queued } from "../host/checks/autolandTrain";

const entry = (name: string, age: number, states: Record<string, string>, ahead = 1) => ({ name, age, ahead, states });

test("[spec wisp autoland-train] a train takes every tip with a deny-list success that no Autoland refusal sits on, oldest first", () => {
  expect(
    queued([
      entry("claude/new", 30, { denylist: "success" }),
      entry("claude/old", 10, { denylist: "success", autoland: "pending" }),
      entry("claude/refused", 5, { denylist: "success", autoland: "failure" }),
      entry("claude/unattested", 6, { denylist: "pending" }),
      entry("claude/missing", 7, {}),
      entry("claude/landed", 8, { denylist: "success" }, 0),
    ]),
  ).toEqual(["claude/old", "claude/new"]);
});

test("[spec wisp autoland-train] a failing train splits into two halves that together hold every branch once", () => {
  expect(halves(["a", "b", "c", "d", "e"])).toEqual([["a", "b", "c"], ["d", "e"]]);
  expect(halves(["a", "b"])).toEqual([["a"], ["b"]]);
});
