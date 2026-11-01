/** One key going down or up as Warcraft reports it to `BlzTriggerRegisterPlayerKeyEvent`: the `oskeytype`, and the `METAKEY_*` mask of the other modifiers held; a press may carry the character it types on the player's layout. */
export interface KeyTransition {
  readonly key: number;
  readonly meta: number;
  readonly down: boolean;
  readonly typed?: string;
}

/** What one key did: whether the game hears it, and the line the player sent with it. */
export interface KeyTaken {
  readonly game: boolean;
  readonly sent?: string;
}

/** The lockstep surface a key feed drives; `LockstepClients` is one. */
export interface KeyClients {
  key(sender: number, key: number, meta: number, down: boolean): void;
  chat(sender: number, message: string): void;
  readonly clients: readonly { readonly slot: number; readonly chatEntry: { key(transition: KeyTransition): KeyTaken } }[];
}

/**
 * Feeds one player's window keyboard to the clients, in order, as the key events Warcraft would raise, so the map's key triggers and its own
 * bindings apply as they do there; the chat entry of the player's own client takes the keys it needs first (wisp:src/headless/chatEntry.ts), and the line it
 * sends is the player's chat event on every client.
 */
export function createKeyFeed(clients: KeyClients, slot: number): (keys: readonly KeyTransition[]) => void {
  return (keys) => {
    const entry = clients.clients.find((client) => client.slot === slot)?.chatEntry;
    for (const transition of keys) {
      const taken = entry?.key(transition);
      if (taken?.sent !== undefined) clients.chat(slot, taken.sent);
      if (taken === undefined || taken.game) clients.key(slot, transition.key, transition.meta, transition.down);
    }
  };
}
