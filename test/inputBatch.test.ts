import { expect, test } from "bun:test";
import { vncActions, vncKey } from "../host/os/warcraft/inputBatch";

test("[scenario] a chat command opens the chat box, types with a real Shift around shifted characters, and sends", () => {
  expect(vncActions([{ kind: "keys", keys: ["Return"], settleMillis: 0 }, { kind: "text", text: "-dev Q", delayMillis: 0 }, { kind: "keys", keys: ["Return"], settleMillis: 0 }])).toEqual([
    "keydown", "return", "pause", "0.3", "keyup", "return",
    "key", "minus", "key", "d", "key", "e", "key", "v", "key", "space", "keydown", "shift", "key", "Q", "keyup", "shift",
    "keydown", "return", "pause", "0.3", "keyup", "return",
  ]);
});

test("[property] X keysym names map to the VNC client's names, chords joined by a dash", () => {
  expect(["Return", "Escape", "ctrl+a", "F10", "BackSpace", "Page_Up"].map(vncKey)).toEqual(["return", "esc", "ctrl-a", "f10", "bsp", "pgup"]);
});
