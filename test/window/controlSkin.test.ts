import { expect, test } from "bun:test";
import { createControlSkins } from "../../host/window/controlSkin";

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

test("a_warcraft_button_template_resolves_its_backdrops_and_highlight_through_inheritance_and_the_skin_table", async () => {
  const skin = await loaded("ScriptDialogButton");
  expect(skin?.backdrop).toEqual({ background: "Skin\\human-back.blp", edge: "Skin\\edge-up.blp", corner: 0.0125, tile: 0.256, insets: [0.005, 0.005, 0.005, 0.005], corners: "UL|UR|BL|BR|T|L|B|R" });
  expect(skin?.pushed?.edge).toBe("Skin\\edge-down.blp");
  expect(skin?.disabled).toBeUndefined();
  expect(skin?.highlight).toBe("Skin\\glow.blp");
});
