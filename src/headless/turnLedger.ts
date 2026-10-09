import type { LinkEvent, LockstepLink } from "./lockstep";

export interface Turn {
  readonly frame: number;
  readonly at: number;
  readonly events: readonly LinkEvent[];
}

export interface TurnPacket {
  readonly from: number;
  readonly frontier: number;
  readonly ack: number;
  readonly turns: readonly Turn[];
  readonly checks: readonly (readonly [frame: number, checksum: string])[];
  readonly done: boolean;
}

export interface ChecksumMismatch {
  readonly frame: number;
  readonly local: string;
  readonly remote: string;
}

const CHECKS_PER_PACKET = 4;

/** One process's side of a two-player match: its own events by due frame, the peer's as packets bring them, and checksum agreement (wisp:docs/network-model.md). */
export class TurnLedger implements LockstepLink {
  delay = 1;
  executed = 0;
  remoteFrontier = 0;
  peerAck = 0;
  remoteDone = false;
  compared = 0;
  lastCompared = 0;
  mismatch: ChecksumMismatch | undefined;
  readonly latencies: number[] = [];
  private advertised = 0;
  private readonly outgoing = new Map<number, { at: number; events: LinkEvent[] }>();
  private readonly incoming = new Map<number, Turn>();
  private readonly localChecks: [number, string][] = [];
  private readonly remoteChecks = new Map<number, string>();

  constructor(readonly local: number, readonly remote: number, private readonly clock: (this: void) => number) {}

  frontier(): number {
    return this.executed + this.delay;
  }

  ready(frame: number): boolean {
    return frame <= this.remoteFrontier;
  }

  readonly sent = (frame: number, event: LinkEvent): void => {
    if (frame <= this.advertised || frame <= this.executed) throw new Error(`an event due at frame ${frame} comes after frame ${Math.max(this.advertised, this.executed)} was promised complete`);
    let turn = this.outgoing.get(frame);
    if (turn === undefined) this.outgoing.set(frame, turn = { at: this.clock(), events: [] });
    turn.events.push(event);
  };

  /** Every event due at `frame`, the lower slot's first, each sender's in the order it sent them. */
  readonly due = (frame: number): readonly LinkEvent[] => {
    if (frame !== this.executed + 1) throw new Error(`frame ${frame} runs after frame ${this.executed}`);
    if (!this.ready(frame)) throw new Error(`frame ${frame} runs before slot ${this.remote}'s events for it arrived (they reach frame ${this.remoteFrontier})`);
    this.executed = frame;
    const own = this.outgoing.get(frame)?.events ?? [];
    const theirs = this.incoming.get(frame);
    this.incoming.delete(frame);
    this.prune();
    if (theirs === undefined) return own;
    this.latencies.push(this.clock() - theirs.at);
    return this.local < this.remote ? [...own, ...theirs.events] : [...theirs.events, ...own];
  };

  check(frame: number, checksum: string): void {
    this.localChecks.push([frame, checksum]);
    if (this.localChecks.length > CHECKS_PER_PACKET) this.localChecks.shift();
    this.compare(frame, checksum, this.remoteChecks.get(frame));
  }

  /** Everything the peer may lack: this side's turns after its last acknowledgement, up to the frontier this packet promises. */
  packet(done = false): TurnPacket {
    const frontier = this.frontier();
    this.advertised = Math.max(this.advertised, frontier);
    const turns: Turn[] = [];
    const frames = [...this.outgoing.keys()].filter((frame) => frame > this.peerAck && frame <= frontier).sort((a, b) => a - b);
    for (const frame of frames) {
      const turn = this.outgoing.get(frame);
      if (turn !== undefined) turns.push({ frame, at: turn.at, events: turn.events });
    }
    return { from: this.local, frontier, ack: this.remoteFrontier, turns, checks: [...this.localChecks], done };
  }

  receive(packet: TurnPacket): void {
    if (packet.from !== this.remote) return;
    if (packet.done) this.remoteDone = true;
    this.peerAck = Math.max(this.peerAck, packet.ack);
    if (packet.frontier > this.remoteFrontier) {
      for (const turn of packet.turns) if (turn.frame > this.remoteFrontier) this.incoming.set(turn.frame, turn);
      this.remoteFrontier = packet.frontier;
    }
    for (const [frame, checksum] of packet.checks) {
      if (this.remoteChecks.has(frame) || frame <= this.lastCompared) continue;
      this.remoteChecks.set(frame, checksum);
      const local = this.localChecks.find(([at]) => at === frame);
      if (local !== undefined) this.compare(frame, local[1], checksum);
    }
    this.prune();
  }

  private compare(frame: number, local: string, remote: string | undefined): void {
    if (remote === undefined) return;
    this.compared++;
    this.lastCompared = Math.max(this.lastCompared, frame);
    this.remoteChecks.delete(frame);
    if (local !== remote && this.mismatch === undefined) this.mismatch = { frame, local, remote };
  }

  private prune(): void {
    for (const frame of [...this.outgoing.keys()]) if (frame <= this.peerAck && frame <= this.executed) this.outgoing.delete(frame);
  }
}
