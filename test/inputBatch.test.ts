import { expect, test } from "bun:test";
import { inputBatches } from "../scripts/warcraft/inputBatch";

test("[scenario] a held acceptance key stays down for its duration before release", () => {
  expect(inputBatches([{ kind: "keys", keys: ["z"], holdMillis: 120 }], { x: 0, y: 0 })).toEqual([
    { args: ["keydown", "--clearmodifiers", "z", "sleep", "0.12", "keyup", "--clearmodifiers", "z"] },
  ]);
});
