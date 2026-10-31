import type { FrameSnapshot } from "../../src/game/native/frameStore";
import type { Backdrop, ControlSkin } from "./controlSkin";

/** A frame as the native window takes it: a frame made from a Warcraft control template carries the backdrop its state shows and, under the cursor, the texture added over it. */
export type NativeUiFrame = FrameSnapshot & { readonly backdrop?: Backdrop; readonly highlight?: string };

/** The frame with its control template's look for its state: pushed or disabled backdrops when the template has them, the highlight while hovered or pushed. */
export function skinned(frame: FrameSnapshot, skin: (template: string) => ControlSkin | undefined): NativeUiFrame {
  const look = frame.template === undefined ? undefined : skin(frame.template);
  if (look === undefined) return frame;
  const backdrop = (frame.control === "pushed" ? look.pushed : frame.control === "disabled" ? look.disabled : undefined) ?? look.backdrop;
  const lit = (frame.control === "hover" || frame.control === "pushed") && look.highlight !== undefined;
  return { ...frame, ...(backdrop === undefined ? {} : { backdrop }), ...(lit ? { highlight: look.highlight } : {}) };
}

/** The frames the native window draws: visible, with some alpha and a rectangle, and the fields its UI renderer reads (window/wisp-window/src/ui/scene.rs). */
export function nativeUi(ui: readonly NativeUiFrame[]): NativeUiFrame[] {
  return ui.filter((frame) => frame.visible && frame.alpha > 0 && frame.rectangle !== undefined && (frame.texture !== "" || frame.text !== "" || frame.sprite !== undefined || frame.backdrop !== undefined));
}

const FONT_FILE = /\.(ttf|otf)$/i;

/** The textures and font files the drawn frames name, each once: Bun pushes them to the window before the frames can show them. */
export function uiAssets(frames: readonly NativeUiFrame[]): string[] {
  const paths = new Set<string>();
  for (const frame of frames) {
    if (frame.backdrop !== undefined) for (const path of [frame.backdrop.background, frame.backdrop.edge]) if (path !== "") paths.add(path);
    if (frame.highlight !== undefined) paths.add(frame.highlight);
    if (frame.texture !== "") paths.add(frame.texture);
    if (frame.text !== "" && FONT_FILE.test(frame.font.file)) paths.add(frame.font.file);
  }
  return [...paths];
}
