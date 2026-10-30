import type { FrameSnapshot } from "../../src/headless/frames";

/** The frames the native window draws: visible, with some alpha and a rectangle, and the fields its UI renderer reads (window/wisp-window/src/ui/scene.rs). */
export function nativeUi(ui: readonly FrameSnapshot[]): FrameSnapshot[] {
  return ui.filter((frame) => frame.visible && frame.alpha > 0 && frame.rectangle !== undefined && (frame.texture !== "" || frame.text !== ""));
}

const FONT_FILE = /\.(ttf|otf)$/i;

/** The textures and font files the drawn frames name, each once: Bun pushes them to the window before the frames can show them. */
export function uiAssets(frames: readonly FrameSnapshot[]): string[] {
  const paths = new Set<string>();
  for (const frame of frames) {
    if (frame.texture !== "") paths.add(frame.texture);
    if (frame.text !== "" && FONT_FILE.test(frame.font.file)) paths.add(frame.font.file);
  }
  return [...paths];
}
