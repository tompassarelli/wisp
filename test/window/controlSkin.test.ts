import { expect, test } from "bun:test";
import { createControlSkins } from "../../host/window/controlSkin";
import { parseFdf } from "../../host/window/fdf";
import { skinned } from "../../host/window/nativeUi";
import { Frames, type FrameSnapshot } from "../../src/game/native/frameStore";

const BASE = `
// made for this test: the shape of a frame file, with our own names and paths
Frame "BACKDROP" "RestTemplate" {
    DecorateFileNames,
    BackdropTileBackground,
    BackdropBackground  "RestBack",
    BackdropCornerFlags "UL|UR|BL|BR|T|L|B|R",
    BackdropCornerSize  0.0125,
    BackdropBackgroundSize  0.256,
    BackdropBackgroundInsets 0.005 0.005 0.005 0.005,
    BackdropEdgeFile  "RestEdge",
}
Frame "BACKDROP" "DownTemplate" INHERITS "RestTemplate" {
    BackdropEdgeFile  "DownEdge",
}
Frame "HIGHLIGHT" "GlowTemplate" {
    DecorateFileNames,
    HighlightType "FILETEXTURE",
    HighlightAlphaFile "Glow",
    HighlightAlphaMode "ADD",
}
Frame "GLUETEXTBUTTON" "BaseButton" {
    Width 0.228f,
    ControlBackdrop "BaseRest",
    Frame "BACKDROP" "BaseRest" INHERITS "RestTemplate" {
    }
    ControlPushedBackdrop "BaseDown",
    Frame "BACKDROP" "BaseDown" INHERITS "DownTemplate" {
    }
    ControlMouseOverHighlight "BaseGlow",
    Frame "HIGHLIGHT" "BaseGlow" INHERITS "GlowTemplate" {
    }
}`;

const BUTTON = `
IncludeFile "Test\\Base.fdf",
Frame "GLUETEXTBUTTON" "ScriptDialogButton" INHERITS WITHCHILDREN "BaseButton" {
    ButtonText "ScriptDialogButtonText",
    Frame "TEXT" "ScriptDialogButtonText" {
        Text "",
    }
}`;

const SKINS = "[Main]\nSkins=Human\n\n[Human]\nRestBack=Skin\\human-back.blp\n\n[Default]\nRestBack=Skin\\default-back.blp\nRestEdge=Skin\\edge-up.blp\nDownEdge=Skin\\edge-down.blp\nGlow=Skin\\glow.blp\n";

const files = new Map<string, string>([["UI\\FrameDef\\UI\\ScriptDialog.fdf", BUTTON], ["Test\\Base.fdf", BASE], ["UI\\war3skins.txt", SKINS]]);
const read = async (path: string) => { const text = files.get(path); return text === undefined ? undefined : new TextEncoder().encode(text); };

const loaded = async (template: string) => {
  const skins = createControlSkins(read, (problem) => { throw new Error(problem); });
  expect(skins.skin(template)).toBeUndefined();
  for (let tries = 0; tries < 100 && skins.skin(template) === undefined; tries++) await Bun.sleep(1);
  return skins.skin(template);
};

test("parseFdf_reads_frames_inheritance_fields_and_includes", () => {
  const file = parseFdf(BUTTON);
  expect(file.includes).toEqual(["Test\\Base.fdf"]);
  const [button] = file.frames;
  expect([button?.type, button?.name, button?.inherits, button?.withChildren]).toEqual(["GLUETEXTBUTTON", "ScriptDialogButton", "BaseButton", true]);
  expect(button?.children.map((child) => child.name)).toEqual(["ScriptDialogButtonText"]);
  expect(parseFdf(BASE).frames[0]?.fields.get("BackdropBackgroundInsets")).toEqual(["0.005", "0.005", "0.005", "0.005"]);
});

test("a_warcraft_button_template_resolves_its_backdrops_and_highlight_through_inheritance_and_the_skin_table", async () => {
  const skin = await loaded("ScriptDialogButton");
  expect(skin?.backdrop).toEqual({ background: "Skin\\human-back.blp", edge: "Skin\\edge-up.blp", corner: 0.0125, tile: 0.256, insets: [0.005, 0.005, 0.005, 0.005], corners: "UL|UR|BL|BR|T|L|B|R" });
  expect(skin?.pushed?.edge).toBe("Skin\\edge-down.blp");
  expect(skin?.disabled).toBeUndefined();
  expect(skin?.highlight).toBe("Skin\\glow.blp");
});

test("a_templated_frame_draws_the_backdrop_and_highlight_of_its_state", async () => {
  const skin = await loaded("ScriptDialogButton");
  const frames = new Frames(new Map());
  let id = 0;
  const button = frames.create(() => ({ kind: "framehandle", id: ++id }), "ScriptDialogButton", undefined, 0);
  button.points.set("c", { x: 0.4, y: 0.3 });
  const look = () => skinned(frames.snapshot().find((each) => each.handle.id === button.id) as FrameSnapshot, () => skin);
  expect(look().template).toBe("ScriptDialogButton");
  expect([look().backdrop?.edge, look().highlight]).toEqual(["Skin\\edge-up.blp", undefined]);
  frames.point(button, undefined);
  expect([look().control, look().backdrop?.edge, look().highlight]).toEqual(["hover", "Skin\\edge-up.blp", "Skin\\glow.blp"]);
  frames.point(button, button);
  expect([look().control, look().backdrop?.edge, look().highlight]).toEqual(["pushed", "Skin\\edge-down.blp", "Skin\\glow.blp"]);
  frames.point(undefined, button);
  expect([look().control, look().highlight]).toEqual([undefined, undefined]);
});
