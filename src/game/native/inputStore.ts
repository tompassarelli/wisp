/** What a player's keyboard, mouse and window hold now on one running game's client, which the host's window feed or a test sets and the native backend's local input reads return. */
export class Input {
  readonly heldMouseButtons = new Set<unknown>();
  pointerX = 0;
  pointerY = 0;
  private readonly heldKeys = new Set<number>();
  private heldMeta = 0;

  hold(key: number, meta: number, down: boolean): void {
    this.heldMeta = meta;
    if (down) this.heldKeys.add(key);
    else this.heldKeys.delete(key);
  }

  keyHeld(key: number): boolean {
    return this.heldKeys.has(key);
  }

  metaHeld(meta: number): boolean {
    return (this.heldMeta & meta) === meta;
  }

  mouseButtonHeld(button: unknown): boolean {
    return this.heldMouseButtons.has(button);
  }

  /** Whether the window has the focus; a headless client's always does. */
  focused(): boolean {
    return true;
  }
}
