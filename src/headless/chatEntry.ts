import type { NativeBehavior } from "./clientTypes";
import type { KeyTaken, KeyTransition } from "./keyInput";

const BACKSPACE = 0x08, ENTER = 0x0d, ESCAPE = 0x1b;

/** UTF-16 units the line holds, about what Warcraft's Enter box takes in one line. */
const CHAT_ENTRY_LIMIT = 127;

const TO_GAME: KeyTaken = { game: true };
const TAKEN: KeyTaken = { game: false };

const LOW_SURROGATE = 0xdc00, AFTER_SURROGATES = 0xe000;

/** `line` without its last character, both halves of a surrogate pair at once. */
function withoutLast(line: string): string {
  const last = line.charCodeAt(line.length - 1);
  return line.slice(0, line.length - (last >= LOW_SURROGATE && last < AFTER_SURROGATES ? 2 : 1));
}

/**
 * The native window's chat line, Wisp's stand-in for Warcraft's Enter box, which the window does not have: Enter or a click where the map draws
 * it opens it, each typed character goes in, Backspace takes the last one back, Enter sends the text as the player's chat and Escape closes
 * it unsent. While it is open the game hears no key the player presses; the release of a key pressed before it opened still reaches the game,
 * so no key stays held. It is the local player's alone and never synchronized; only the line it sends is, as a chat event.
 */
export class ChatEntry {
  private line: string | undefined;
  private readonly taken = new Set<number>();
  private area: readonly [left: number, bottom: number, right: number, top: number] | undefined;

  /** The line while it is open, undefined while it is closed. */
  get text(): string | undefined {
    return this.line;
  }

  open(): void {
    this.line ??= "";
  }

  /** Where the map draws the line, in Warcraft's 0.8 by 0.6 UI coordinates (`WispSetChatEntryArea`); a left click there opens it, and an empty area is none. */
  place(left: number, bottom: number, width: number, height: number): void {
    this.area = width > 0 && height > 0 ? [left, bottom, left + width, bottom + height] : undefined;
  }

  /** Whether a click at UI point x, y lands on the line. */
  holds(x: number, y: number): boolean {
    const area = this.area;
    return area !== undefined && x >= area[0] && y >= area[1] && x <= area[2] && y <= area[3];
  }

  /** `WispChatEntryText` and `WispSetChatEntryArea`, the map's reads and writes of the line. */
  behaviors(): Readonly<Record<string, NativeBehavior>> {
    return {
      WispChatEntryText: () => this.line,
      WispSetChatEntryArea: (left: number, bottom: number, width: number, height: number) => { this.place(left, bottom, width, height); },
    };
  }

  key(transition: KeyTransition): KeyTaken {
    if (!transition.down) return this.taken.delete(transition.key) ? TAKEN : TO_GAME;
    const line = this.line;
    if (line === undefined) {
      if (transition.key !== ENTER) return TO_GAME;
      this.taken.add(transition.key);
      this.line = "";
      return TAKEN;
    }
    this.taken.add(transition.key);
    if (transition.key === ENTER || transition.key === ESCAPE) {
      this.line = undefined;
      return transition.key === ENTER && line.trim() !== "" ? { game: false, sent: line } : TAKEN;
    }
    if (transition.key === BACKSPACE) this.line = withoutLast(line);
    else if (transition.typed !== undefined && line.length + transition.typed.length <= CHAT_ENTRY_LIMIT) this.line = line + transition.typed;
    return TAKEN;
  }
}
