import { floorDiv } from "../sim/intMath";

/** One key going down or up as Warcraft reports it to `BlzTriggerRegisterPlayerKeyEvent`: the `oskeytype`, and the `METAKEY_*` mask of the other modifiers held. */
export interface KeyTransition {
  readonly key: number;
  readonly meta: number;
  readonly down: boolean;
}

/** The number `wisp_window_take_keys` hands over for one event: the key in bits 0 to 7, the meta mask in 8 to 11, down in bit 12 (`KeyEvent::packed` in the window's keys.rs). */
export function unpackKey(packed: number): KeyTransition {
  return { key: packed & 0xff, meta: floorDiv(packed, 0x100) & 0xf, down: (packed & 1 << 12) !== 0 };
}

/** The lockstep surface a key feed drives; `LockstepClients` is one. */
export interface KeyClients {
  key(sender: number, key: number, meta: number, down: boolean): void;
}

/** Feeds one player's window keyboard to the clients, in order, as the key events Warcraft would raise, so the map's key triggers and its own bindings apply as they do there. */
export function createKeyFeed(clients: KeyClients, slot: number): (keys: readonly KeyTransition[]) => void {
  return (keys) => {
    for (const { key, meta, down } of keys) clients.key(slot, key, meta, down);
  };
}
