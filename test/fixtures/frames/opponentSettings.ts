


import type { FrameDefinition, FrameNode } from "../../../scripts/wisp/frames";

const FONT = "Fonts\\FRIZQT__.TTF";
const label = (key: string, x: number, y: number, width: number, height: number, size: number): FrameNode =>
  ({ key, type: "TEXT", width, height, font: { file: FONT, size }, enabled: false, points: [{ point: "TOPLEFT", relative: "root", x, y }] });
const button = (key: string, text: string, x: number, y: number, width: number): FrameNode =>
  ({ key, type: "GLUETEXTBUTTON", inherits: "ScriptDialogButton", text, width, height: 0.027, points: [{ point: "TOPLEFT", relative: "root", x, y }] });
const row = (name: string, caption: string, y: number): FrameNode[] => [
  { ...label(`${name}Caption`, 0.03, y, 0.16, 0.027, 0.012), text: caption },
  button(`${name}Previous`, "<", 0.205, y, 0.04),
  label(`${name}Value`, 0.25, y, 0.23, 0.027, 0.012),
  button(`${name}Next`, ">", 0.485, y, 0.04),
];

export const opponentSettings: FrameDefinition = {
  name: "OpponentSettings",
  type: "BACKDROP",
  width: 0.56,
  height: 0.34,
  at: { point: "TOPLEFT", x: 0.12, y: 0.44 },
  texture: "UI\\Widgets\\ToolTips\\Human\\human-tooltip-background.blp",
  level: 100,
  children: [
    label("title", 0.03, -0.009, 0.42, 0.03, 0.014),
    button("close", "Close", 0.455, -0.009, 0.075),
    ...row("opponent", "Opponent", -0.063),
    ...row("difficulty", "Difficulty", -0.107),
    { ...label("preview", 0.03, -0.153, 0.5, 0.127, 0.012), justify: { horizontal: "LEFT", vertical: "TOP" } },
    button("done", "Done", 0.21, -0.289, 0.14),
    label("prompt", 0.01, -0.321, 0.54, 0.018, 0.01),
  ],
};
