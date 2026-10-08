import { expect, test } from "bun:test";
import { orderDrawnModels } from "../scripts/wisp/drawOrder";

test("[native] the opaque platform draws before pooled floor-tech cues (#72)", () => {
  // Smashcraft f9d0fbf3, Classic capture frame 422: the floor cue clears 1,000 pixels despite being created before the platform.
  const poses = [
    { name: "floor cue", layers: [4] },
    { name: "platform", layers: [0] },
    { name: "dust", layers: [] },
  ];
  expect(orderDrawnModels(poses, (pose) => [{ Layers: pose.layers.map((FilterMode) => ({ FilterMode })) }]).map((pose) => pose.name)).toEqual(["platform", "floor cue", "dust"]);
});
