import type { LinkEvent, LockstepLink } from "./lockstep";

export interface Turn {
  readonly frame: number;
  readonly at: number;
  readonly events: readonly LinkEvent[];
}

export interface TurnPacket {
  readonly from: number;
  readonly frontier: number;
  /** What the sender has received from each member, indexed by slot (0 for itself and any slot it hears nothing from). */
  readonly acks: readonly number[];
  readonly turns: readonly Turn[];
  readonly checks: readonly (readonly [frame: number, checksum: string])[];
  readonly done: boolean;
}

export interface ChecksumMismatch {
  readonly frame: number;
  readonly peer: number;
  readonly local: string;
  readonly remote: string;
}

const CHECKS_PER_PACKET = 4;

class Remote {
  frontier = 0;
  ack = 0;
  done = false;
  departed = false;
  lastCompared = 0;
  readonly incoming = new Map<number, Turn>();
  readonly checks = new Map<number, string>();
  constructor(readonly slot: number) {}
}

/** One process's side of a match with up to four humans: its own events by due frame, each peer's as packets bring them, and checksum agreement (wisp:docs/network-model.md). */
export class TurnLedger implements LockstepLink {
  delay = 1;
  executed = 0;
  compared = 0;
  mismatch: ChecksumMismatch | undefined;
  readonly latencies: number[] = [];
  private advertised = 0;
  private readonly peers: readonly Remote[];
  private readonly outgoing = new Map<number, { at: number; events: LinkEvent[] }>();
  private readonly localChecks: [number, string][] = [];

  constructor(readonly local: number, readonly remotes: readonly number[], private readonly clock: (this: void) => number) {
    this.peers = remotes.map((slot) => new Remote(slot));
  }

  /** The last frame every peer has promised complete. */
  get remoteFrontier(): number {
    return Math.min(...this.peers.map((peer) => peer.frontier));
  }

  /** The last frame every peer still in the match has acknowledged. */
  get peerAck(): number {
    return Math.min(Infinity, ...this.present().map((peer) => peer.ack));
  }

  get remoteDone(): boolean {
    return this.peers.every((peer) => peer.done || peer.departed);
  }

  get lastCompared(): number {
    return Math.min(Infinity, ...this.present().map((peer) => peer.lastCompared));
  }

  frontierOf(slot: number): number {
    return this.peer(slot)?.frontier ?? 0;
  }

  frontier(): number {
    return this.executed + this.delay;
  }

  ready(frame: number): boolean {
    return frame <= this.remoteFrontier;
  }

  /** A peer that left having sent all it promised stops holding back acknowledgements, checksums and the end of the match. */
  depart(slot: number): void {
    const peer = this.peer(slot);
    if (peer !== undefined) peer.departed = true;
    this.prune();
  }

  readonly sent = (frame: number, event: LinkEvent): void => {
    if (frame <= this.advertised || frame <= this.executed) throw new Error(`an event due at frame ${frame} comes after frame ${Math.max(this.advertised, this.executed)} was promised complete`);
    let turn = this.outgoing.get(frame);
    if (turn === undefined) this.outgoing.set(frame, turn = { at: this.clock(), events: [] });
    turn.events.push(event);
  };

  /** Every event due at `frame`, the lowest slot's first, each sender's in the order it sent them. */
  readonly due = (frame: number): readonly LinkEvent[] => {
    if (frame !== this.executed + 1) throw new Error(`frame ${frame} runs after frame ${this.executed}`);
    if (!this.ready(frame)) throw new Error(`frame ${frame} runs before every peer's events for it arrived (they reach frame ${this.remoteFrontier})`);
    this.executed = frame;
    const turns: { slot: number; events: readonly LinkEvent[] }[] = [{ slot: this.local, events: this.outgoing.get(frame)?.events ?? [] }];
    for (const peer of this.peers) {
      const theirs = peer.incoming.get(frame);
      peer.incoming.delete(frame);
      if (theirs === undefined) continue;
      this.latencies.push(this.clock() - theirs.at);
      turns.push({ slot: peer.slot, events: theirs.events });
    }
    this.prune();
    return turns.sort((a, b) => a.slot - b.slot).flatMap(({ events }) => events);
  };

  check(frame: number, checksum: string): void {
    this.localChecks.push([frame, checksum]);
    if (this.localChecks.length > CHECKS_PER_PACKET) this.localChecks.shift();
    for (const peer of this.peers) this.compare(peer, frame, checksum, peer.checks.get(frame));
  }

  /** Everything the peers may lack: this side's turns after the slowest acknowledgement, up to the frontier this packet promises. */
  packet(done = false): TurnPacket {
    const frontier = this.frontier();
    this.advertised = Math.max(this.advertised, frontier);
    const turns: Turn[] = [];
    const behind = this.peerAck;
    const frames = [...this.outgoing.keys()].filter((frame) => frame > behind && frame <= frontier).sort((a, b) => a - b);
    for (const frame of frames) {
      const turn = this.outgoing.get(frame);
      if (turn !== undefined) turns.push({ frame, at: turn.at, events: turn.events });
    }
    const acks = Array.from({ length: Math.max(this.local, ...this.remotes) + 1 }, (_, slot) => this.peer(slot)?.frontier ?? 0);
    return { from: this.local, frontier, acks, turns, checks: [...this.localChecks], done };
  }

  receive(packet: TurnPacket): void {
    const peer = this.peer(packet.from);
    if (peer === undefined) return;
    if (packet.done) peer.done = true;
    peer.ack = Math.max(peer.ack, packet.acks[this.local] ?? 0);
    if (packet.frontier > peer.frontier) {
      for (const turn of packet.turns) if (turn.frame > peer.frontier) peer.incoming.set(turn.frame, turn);
      peer.frontier = packet.frontier;
    }
    for (const [frame, checksum] of packet.checks) {
      if (peer.checks.has(frame) || frame <= peer.lastCompared) continue;
      peer.checks.set(frame, checksum);
      const local = this.localChecks.find(([at]) => at === frame);
      if (local !== undefined) this.compare(peer, frame, local[1], checksum);
    }
    this.prune();
  }

  private peer(slot: number): Remote | undefined {
    return this.peers.find((peer) => peer.slot === slot);
  }

  private present(): readonly Remote[] {
    return this.peers.filter((peer) => !peer.departed);
  }

  private compare(peer: Remote, frame: number, local: string, remote: string | undefined): void {
    if (remote === undefined) return;
    this.compared++;
    peer.lastCompared = Math.max(peer.lastCompared, frame);
    peer.checks.delete(frame);
    if (local !== remote && this.mismatch === undefined) this.mismatch = { frame, peer: peer.slot, local, remote };
  }

  private prune(): void {
    const acked = this.peerAck;
    for (const frame of [...this.outgoing.keys()]) if (frame <= acked && frame <= this.executed) this.outgoing.delete(frame);
  }
}
