import { expect, test } from "bun:test";
import { inputBatches } from "../scripts/warcraft/inputBatch";

test("observed command submission can return after key release before the first scripted frame", () => {
  expect(inputBatches([{ kind: "keys", keys: ["Return"], settleMillis: 0 }], { x: 0, y: 0 })).toEqual([
    { args: ["keydown", "--clearmodifiers", "Return", "sleep", "0.3", "keyup", "--clearmodifiers", "Return"] },
  ]);
  expect(inputBatches([{ kind: "keys", keys: ["Return"] }], { x: 0, y: 0 })[0]?.args.slice(-2)).toEqual(["sleep", "0.66"]);
});

test("batched input keeps text literal and moves relative to the preceding click", () => {
  const plan = inputBatches([
    { kind: "click", x: 400, y: 300 },
    { kind: "keys", keys: ["ctrl+a"] },
    { kind: "text", text: "-game $HOME `command`" },
    { kind: "wait", millis: 40 },
    { kind: "click", x: 600, y: 250, settleMillis: 80, holdMillis: 50 },
  ], { x: 500, y: 400 });
  expect(plan).toEqual([
    { args: ["mousemove_relative", "--", "-100", "-100", "getmouselocation", "--shell"], pointer: { x: 400, y: 300 } },
    { args: ["sleep", "0.12", "mousedown", "1", "sleep", "0.06", "mouseup", "1", "key", "--clearmodifiers", "--delay", "12", "ctrl+a", "type", "--clearmodifiers", "--delay", "12", "--", "-game $HOME `command`"] },
    { args: ["sleep", "0.04", "mousemove_relative", "--", "200", "-50", "getmouselocation", "--shell"], pointer: { x: 600, y: 250 } },
    { args: ["sleep", "0.08", "mousedown", "1", "sleep", "0.05", "mouseup", "1"] },
  ]);
});
