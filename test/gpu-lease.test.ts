import { expect, test } from "bun:test";
import { agentRender } from "../host/play/standalone";

// The shell is the reference for quoting: it must read the named command back as the helper, the gpu class and every argument.

test("only a headless, scripted or capturing standalone run needs a gpu lease, never the window a person plays (docs/play.md)", () => {
  expect(agentRender({})).toBe(false);
  expect(agentRender({ window: "native", frames: 10 })).toBe(false);
  for (const options of [{ headless: true }, { script: "pad.txt" }, { out: "dir" }, { recordChecksums: true }, { captureFrames: [3] }]) expect(agentRender(options)).toBe(true);
});
