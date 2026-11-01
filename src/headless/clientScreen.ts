/** Pixels `BlzGetLocalClientWidth/Height` report, which a window's cursor is mapped into; the client's frame natives read the same one. An interface, not a class with private fields, so a consumer that sees Wisp through both its source and its published types finds it compatible with itself. */
export interface ClientScreen {
  readonly width: number;
  readonly height: number;
  /** Sizes the screen to the window the client is drawn in, as Warcraft's client reports its own window; a zero side, a minimised window, keeps the last size. */
  resize(width: number, height: number): void;
}

/** A screen of `size`; unset, 1920 x 1080, what a lockstep's first client reports. */
export function clientScreen(size: { readonly width: number; readonly height: number } = { width: 1920, height: 1080 }): ClientScreen {
  const screen = {
    width: size.width,
    height: size.height,
    resize(width: number, height: number): void {
      if (width <= 0 || height <= 0) return;
      screen.width = width;
      screen.height = height;
    },
  };
  return screen;
}
