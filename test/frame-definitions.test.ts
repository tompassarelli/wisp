import { expect, test } from "bun:test";
import { frameDefinitionProblems, generateFrames, type FrameDefinition } from "../host/compile/frames";
import { opponentSettings } from "./fixtures/frames/opponentSettings";

const arch: FrameDefinition = {
  name: "RaceArch",
  type: "SIMPLEFRAME",
  width: 0.0625,
  height: 0.125,
  at: { point: "BOTTOMLEFT", x: 0.25, y: 0 },
  textures: [
    { key: "overlay", layer: "ARTWORK", file: "UI\\Glow.blp", alphaMode: "BLEND", width: 0.03125, height: 0.03125, anchor: { point: "TOPRIGHT", x: -0.0078125, y: -0.0078125 } },
    { key: "tile", layer: "BACKGROUND", file: "UI\\Console\\Human\\HumanUITile01.blp", texCoord: [0.5, 1, 0, 0.5], alphaMode: "ALPHAKEY" },
    { key: "empty", layer: "ARTWORK" },
  ],
};

test("[scenario] a SIMPLEFRAME definition generates its FDF by layer with TexCoord and bindings that create it and fetch each texture, and bad layers, coordinates and key collisions are named", () => {
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
    "            SetAllPoints,",
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
  ] };
  expect(frameDefinitionProblems(bad)).toEqual([
    '"tile": unknown layer "MIDDLE"; Warcraft draws only BACKGROUND and ARTWORK',
    '"border": unknown layer "BORDER"; Warcraft draws only BACKGROUND and ARTWORK',
    '"overlay": unknown layer "OVERLAY"; Warcraft draws only BACKGROUND and ARTWORK',
    '"tile": duplicate key',
    '"tile": texCoord needs left, right, top and bottom within 0..1',
    '"wide": texCoord needs left, right, top and bottom within 0..1',
  ]);
  expect(() => generateFrames(bad)).toThrow('unknown layer "MIDDLE"');
});

test("[scenario] a FRAME definition's bindings use the game API: loadFrameFile, createFrame, setFrameAbsPoint, setFrameLevel, namedFrame, setFrameText and setFrameEnabled over Frame handles", () => {
  const lines = generateFrames(opponentSettings).bindings.split("\n");
  expect(lines[0]).toBe('import { createFrame, Frame, FramePoint, loadFrameFile, namedFrame, setFrameAbsPoint, setFrameEnabled, setFrameLevel, setFrameText } from "wisp/game/frames";');
  expect(lines).toContain('  if (!loadFrameFile(OPPONENTSETTINGS_TOC)) return undefined;');
  expect(lines).toContain('  const root = createFrame("OpponentSettings", parent, 0, context);');
  expect(lines).toContain("  setFrameAbsPoint(root, FramePoint.topLeft, 0.11999999731779099, 0.4399999976158142);");
  expect(lines).toContain("  setFrameLevel(root, 100);");
  expect(lines).toContain('    close: namedFrame("OpponentSettingsClose", context),');
  expect(lines).toContain('  setFrameText(frames.close, "Close");');
  expect(lines).toContain("  setFrameEnabled(frames.title, false);");
  expect(lines.join("\n")).not.toContain("Blz");
});
