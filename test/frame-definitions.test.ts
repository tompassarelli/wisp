import { expect, test } from "bun:test";
import { frameDefinitionProblems, generateFrames, type FrameDefinition } from "../host/compile/frames";

const arch: FrameDefinition = {
  name: "RaceArch",
  type: "SIMPLEFRAME",
  width: 0.0625,
  height: 0.125,
  at: { point: "BOTTOMLEFT", x: 0.25, y: 0 },
  textures: [
    { key: "overlay", layer: "ARTWORK", file: "UI\\Glow.blp", alphaMode: "BLEND", width: 0.03125, height: 0.03125, anchor: { point: "TOPRIGHT", x: -0.0078125, y: -0.0078125 } },
    { key: "tile", layer: "BACKGROUND", file: "UI\\Console\\Human\\HumanUITile01.blp", texCoord: [0.5, 1, 0, 0.5], alphaMode: "ALPHAKEY" },
    { key: "empty", layer: "ARTWORK", width: 0.03125, height: 0.03125, anchor: { point: "BOTTOMLEFT", x: 0, y: 0 } },
  ],
};

test("[scenario] a SIMPLEFRAME definition generates its FDF by layer with TexCoord and bindings that create it and fetch each texture, and bad layers, coordinates, key collisions and textures overlapping in one layer are named", () => {
  const generated = generateFrames(arch);
  expect(generated.fdf).toBe([
    'Frame "SIMPLEFRAME" "RaceArch" {',
    "    Width 0.0625,",
    "    Height 0.125,",
    '    Layer "BACKGROUND" {',
    '        Texture "RaceArchTile" {',
    '            File "UI\\Console\\Human\\HumanUITile01.blp",',
    "            TexCoord 0.5, 1, 0, 0.5,",
    '            AlphaMode "ALPHAKEY",',
    "            SetAllPoints,",
    "        }",
    "    }",
    '    Layer "ARTWORK" {',
    '        Texture "RaceArchOverlay" {',
    '            File "UI\\Glow.blp",',
    '            AlphaMode "BLEND",',
    "            Width 0.03125,",
    "            Height 0.03125,",
    "            Anchor TOPRIGHT, -0.007813, -0.007813,",
    "        }",
    '        Texture "RaceArchEmpty" {',
    "            Width 0.03125,",
    "            Height 0.03125,",
    "            Anchor BOTTOMLEFT, 0, 0,",
    "        }",
    "    }",
    "}",
    "",
  ].join("\n"));
  expect(generated.bindings).toContain("const root = createSimpleFrame(\"RaceArch\", parent, context);");
  expect(generated.bindings).toContain("setFrameAbsPoint(root, FramePoint.bottomLeft, 0.25, 0);");
  for (const key of ["overlay", "tile", "empty"]) {
    expect(generated.bindings).toContain(`readonly ${key}: Frame;`);
    expect(generated.bindings).toContain(`${key}: namedFrame("RaceArch${key.charAt(0).toUpperCase()}${key.slice(1)}", context),`);
  }
  expect(generated.bindings.split("\n")[0]).toBe('import { createSimpleFrame, Frame, FramePoint, loadFrameFile, namedFrame, setFrameAbsPoint } from "wisp/game/frames";');
  expect(generated.bindings).not.toContain("Blz");

  const bad = { ...arch, textures: [
    { key: "tile", layer: "MIDDLE" as never },
    { key: "border", layer: "BORDER" as never },
    { key: "overlay", layer: "OVERLAY" as never },
    { key: "tile", layer: "ARTWORK" as const, texCoord: [0, 1.5, 0, 1] as const },
    { key: "wide", layer: "ARTWORK" as const, texCoord: [-0.25, 1, 0, 1] as const },
    { key: "cover", layer: "ARTWORK" as const, width: 0.03125, height: 0.0625, anchor: { point: "TOPLEFT" as const, x: 0.015625, y: 0 } },
  ] };
  expect(frameDefinitionProblems(bad)).toEqual([
    '"tile": unknown layer "MIDDLE"; Warcraft draws only BACKGROUND and ARTWORK',
    '"border": unknown layer "BORDER"; Warcraft draws only BACKGROUND and ARTWORK',
    '"overlay": unknown layer "OVERLAY"; Warcraft draws only BACKGROUND and ARTWORK',
    '"tile": duplicate key',
    '"tile": texCoord needs left, right, top and bottom within 0..1',
    '"wide": texCoord needs left, right, top and bottom within 0..1',
    '"tile" and "wide": overlap in layer ARTWORK, where Warcraft keeps no draw order',
    '"tile" and "cover": overlap in layer ARTWORK, where Warcraft keeps no draw order',
    '"wide" and "cover": overlap in layer ARTWORK, where Warcraft keeps no draw order',
  ]);
  expect(frameDefinitionProblems({ ...arch, textures: [
    { key: "left", layer: "ARTWORK", width: 0.03125, height: 0.125, anchor: { point: "TOPLEFT", x: 0, y: 0 } },
    { key: "right", layer: "ARTWORK", width: 0.03125, height: 0.125, anchor: { point: "TOPRIGHT", x: 0, y: 0 } },
    { key: "under", layer: "BACKGROUND" },
  ] })).toEqual([]);
  expect(() => generateFrames(bad)).toThrow('unknown layer "MIDDLE"');
});
