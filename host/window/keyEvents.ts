import type { KeyTransition } from "../../src/headless/keyInput";

const TYPED_SHIFT = 2 ** 13;

/** The number `wisp_window_take_keys` hands over for one event: the key in bits 0 to 7, the meta mask in 8 to 11, down in bit 12 and the typed character's code point from bit 13, 0 for none (`KeyEvent::packed` in the window's keys.rs). */
export function unpackKey(packed: number): KeyTransition {
  const key = packed & 0xff, meta = (packed >>> 8) & 0xf, down = (packed & 1 << 12) !== 0, typed = Math.floor(packed / TYPED_SHIFT);
  return typed === 0 ? { key, meta, down } : { key, meta, down, typed: String.fromCodePoint(typed) };
}
