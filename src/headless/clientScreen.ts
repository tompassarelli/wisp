/** Pixels `BlzGetLocalClientWidth/Height` report, which a window's cursor is mapped into; the client's frame natives read the same one. */
export class ClientScreen {
  private pixelWidth: number;
  private pixelHeight: number;

  constructor(size: { readonly width: number; readonly height: number } = { width: 1920, height: 1080 }) {
    this.pixelWidth = size.width;
    this.pixelHeight = size.height;
  }

  get width(): number { return this.pixelWidth; }
  get height(): number { return this.pixelHeight; }

  /** Sizes the screen to the window the client is drawn in, as Warcraft's client reports its own window; a zero side, a minimised window, keeps the last size. */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.pixelWidth = width;
    this.pixelHeight = height;
  }
}
