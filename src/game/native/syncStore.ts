export interface SyncMessage {
  readonly sender: number;
  readonly prefix: string;
  readonly data: string;
}

/** The longest message the relay carries, in characters. */
export const SYNC_LIMIT = 255;

/** The messages that one running game's client has sent and that the host has not yet delivered to every client. */
export class Sync {
  constructor(private readonly slot: number, private readonly outbox: SyncMessage[]) {}

  send(prefix: string, data: string): boolean {
    this.outbox.push({ sender: this.slot, prefix, data });
    return true;
  }
}
