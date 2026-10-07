import { expect, test } from "bun:test";
import { FrameDefinitionError, frameDefinitionProblems, generateFrames, type FrameDefinition } from "../scripts/wisp/frames";
import { opponentSettings } from "./fixtures/frames/opponentSettings";

test("the opponent-settings panel generates FDF, TOC and native bindings", () => {
  const generated = generateFrames(opponentSettings);
  expect(generated.tocEntry).toBe("war3mapImported\\OpponentSettings.toc");
  expect(generated.toc).toBe("war3mapImported\\OpponentSettings.fdf\r\n\r\n");
  expect(generated.fdf.split("\n").slice(0, 6)).toEqual([
    'Frame "BACKDROP" "OpponentSettings" {',
    "    Width 0.56,",
    "    Height 0.34,",
    '    BackdropBackground "UI\\Widgets\\ToolTips\\Human\\human-tooltip-background.blp",',
    "    BackdropBlendAll,",
    '    Frame "TEXT" "OpponentSettingsTitle" {',
  ]);
  expect(generated.fdf).toContain('    Frame "GLUETEXTBUTTON" "OpponentSettingsClose" INHERITS WITHCHILDREN "ScriptDialogButton" {\n        Width 0.075,\n        Height 0.027,\n        SetPoint TOPLEFT, "OpponentSettings", TOPLEFT, 0.455, -0.009,\n    }');
  expect(generated.fdf).toContain('        FrameFont "Fonts\\FRIZQT__.TTF", 0.012, "",\n        FontJustificationH JUSTIFYCENTER,\n        FontJustificationV JUSTIFYMIDDLE,\n        Text "Opponent",');
  expect(generated.fdf.match(/^\s*Frame /gm)?.length).toBe(14);
  expect(generated.bindings).toContain('if (!loaded) loaded = BlzLoadTOCFile(OPPONENTSETTINGS_TOC);');
  expect(generated.bindings).toContain('const root = BlzCreateFrame("OpponentSettings", parent, 0, context);');
  expect(generated.bindings).toContain("BlzFrameSetAbsPoint(root, FRAMEPOINT_TOPLEFT, 0.12, 0.44);");
  expect(generated.bindings).toContain('    opponentNext: BlzGetFrameByName("OpponentSettingsOpponentNext", context),');
  expect(generated.bindings).toContain('  BlzFrameSetText(frames.done, "Done");');
  expect(generated.bindings).toContain("  BlzFrameSetEnable(frames.preview, false);");
  expect(generated.bindings).toContain("  readonly difficultyValue: framehandle;");
});

test("invalid names, references and frame types are reported together at build time", () => {
  const broken = {
    name: "Bad Panel",
    type: "FRAME",
    width: 0.1,
    height: 0.1,
    children: [
      { key: "ok", type: "TEXT", font: { file: "f", size: 0.01 } },
      { key: "ok", type: "TEXT", font: { file: "f", size: 0.01 } },
      { key: "Ok", type: "FRAME" },
      { key: "two words", type: "FRAME" },
      { key: "root", type: "FRAME" },
      { key: "list", type: "LISTBOX" },
      { key: "anchored", type: "FRAME", points: [{ point: "TOPLEFT", relative: "missing", x: 0, y: 0 }] },
      { key: "styled", type: "GLUETEXTBUTTON", inherits: "NoSuchTemplate" },
      { key: "quoted", type: "TEXT", text: 'say "hi"', font: { file: "f", size: 0.01 } },
      { key: "bare", type: "TEXT" },
    ],
  } as unknown as FrameDefinition;
  expect(frameDefinitionProblems(broken)).toEqual([
    'definition name "Bad Panel" is not an identifier',
    '"ok": duplicate key',
    '"Ok": frame name Bad PanelOk is already used',
    '"two words": key is not an identifier',
    '"root": key is reserved',
    '"list": unknown frame type "LISTBOX"',
    '"anchored": anchored to unknown frame "missing"',
    '"styled": inherits unknown template "NoSuchTemplate"',
    '"quoted": text contains a quote or line break',
    '"bare": a TEXT frame needs a font or a template',
  ]);
  expect(() => generateFrames(broken)).toThrow(FrameDefinitionError);
});

test("a definition may inherit its own frames and declared templates", () => {
  const definition: FrameDefinition = {
    name: "Pair", type: "FRAME", width: 0.2, height: 0.1, templates: ["SmashcraftDamage"],
    children: [
      { key: "left", type: "TEXT", inherits: "SmashcraftDamage", points: [{ point: "LEFT", x: 0, y: 0 }] },
      { key: "right", type: "TEXT", inherits: "PairLeft", points: [{ point: "LEFT", relative: "left", relativePoint: "RIGHT", x: 0.01, y: 0 }] },
    ],
  };
  expect(generateFrames(definition).fdf).toContain('SetPoint LEFT, "PairLeft", RIGHT, 0.01, 0,');
});
