import { expect, test } from "bun:test";
import { orderDrawnModels } from "../scripts/wisp/drawOrder";

test("[native] the opaque platform draws before pooled floor-tech cues (#72)", () => {

  const poses = [
    { name: "floor cue", layers: [4] },
    { name: "platform", layers: [0] },
    { name: "dust", layers: [] },
  ];
  expect(orderDrawnModels(poses, (pose) => [{ Layers: pose.layers.map((FilterMode) => ({ FilterMode })) }]).map((pose) => pose.name)).toEqual(["platform", "floor cue", "dust"]);
});
