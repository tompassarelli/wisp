// Simulated clients in lockstep (wisp:docs/headless.md). The clients take turns
// running the same map code, one frame at a time, and every synchronized
// event (chat, keys, sync data any client sends) reaches every client in the
// same order, so clients that took the same events must make the same native
// calls. A hot reload goes through the map's own reloader, from the files the
// host would write. Runtime-neutral, like client.ts.
import { ackFile, formatManifest, hostFile, manifestFile, PAYLOAD_FILE_BYTES, payloadFile } from "../runtime/gameFiles";
import { checksum } from "../runtime/payload";
import { floorDiv } from "../sim/intMath";
import { type ClientScope, HeadlessClient, type LocalNatives, type MapEntry, type NativeBehaviors, type SyncMessage, WISP_LOCAL_NATIVES, describeCall, sameCall } from "./client";
import type { NativeDeclarations } from "./declarations";

export interface LockstepOptions {
  readonly declarations: NativeDeclarations;
  /** One client per human player slot. */
  readonly players: readonly number[];
  /** The map's configureRuntime() filePrefix, which names its reload, acknowledgement and error files. */
  readonly filePrefix: string;
  /** Each client's map entry; called in that client, so a host can load the bundle there. */
  readonly entry: (this: void, client: HeadlessClient) => MapEntry;
  /** The text a hot reload publishes; each client's Lua `load` turns it back into the entry. */
  readonly bundle: string;
  /** The game's local-only natives, added to WISP_LOCAL_NATIVES. */
  readonly localNatives?: LocalNatives;
  readonly natives?: (this: void, client: HeadlessClient) => NativeBehaviors;
  readonly scope?: ClientScope;
  /** When synchronized messages arrive; without it, each arrives before the next frame. */
  readonly delivery?: SyncDelivery;
}

/**
 * When a synchronized message reaches the clients, such as the measured
 * Battle.net latency of wisp:scripts/wisp/syncChannel.ts
 * (wisp:docs/network-model.md).
 */
export interface SyncDelivery {
  /** The frame before whose callbacks every client receives a message `sender` sent during `frame`; later than `frame`. */
  arrivalFrame(this: void, sender: number, frame: number, message: SyncMessage): number;
}

interface InFlight {
  readonly arrival: number;
  readonly message: SyncMessage;
}

/** Synchronized messages that keep causing more are a defect, not a frame. */
const MAX_MESSAGES_PER_FLUSH = 10000;

export class Lockstep {
  readonly network: SyncMessage[] = [];
  readonly clients: readonly HeadlessClient[];
  /** Frames every client has run. */
  frame = 0;
  /** Hot reload versions published so far. */
  version = 0;
  /** With a delivery: messages sent and not yet received, by arrival frame, then send order. */
  readonly inFlight: InFlight[] = [];
  private readonly options: LockstepOptions;

  constructor(options: LockstepOptions) {
    this.options = options;
    const localNatives = { ...WISP_LOCAL_NATIVES, ...options.localNatives };
    const clients: HeadlessClient[] = [];
    for (let index = 0; index < options.players.length; index++) {
      const slot = options.players[index] ?? index;
      clients.push(new HeadlessClient({
        slot,
        filePrefix: options.filePrefix,
        humans: options.players,
        declarations: options.declarations,
        localNatives,
        network: this.network,
        // Different screens, so layout that depends on the local screen is exercised.
        screenWidth: 1920 + 640 * index,
        ...(options.scope === undefined ? {} : { scope: options.scope }),
        ...(options.natives === undefined ? {} : { natives: options.natives }),
      }));
    }
    this.clients = clients;
  }

  /**
   * The map's main(): every client loads its entry and starts it. A host has
   * prepared each client's hot folder first, as `wisp fresh` does before a
   * match, unless `hostFolder` is false: a client no host has touched.
   */
  start(options: { readonly hostFolder?: boolean } = {}): void {
    if (options.hostFolder !== false) this.prepareHostFolder();
    const entry = this.options.entry;
    for (const client of this.clients) {
      client.run(() => entry(client).start());
    }
    this.flush();
  }

  /** Runs `body` on every client, such as an entry the test chooses or an install() outside the reloader. */
  everywhere(body: (this: void) => void): void {
    for (const client of this.clients) client.run(body);
    this.flush();
  }

  /** Synchronized messages reach every client in the order they were sent, at once or at their arrival frame. */
  private flush(): void {
    const delivery = this.options.delivery;
    if (delivery !== undefined) {
      for (let message = this.network.shift(); message !== undefined; message = this.network.shift()) {
        const arrival = delivery.arrivalFrame(message.sender, this.frame, message);
        if (arrival <= this.frame) throw new Error(`a message sent during frame ${this.frame} arrives at frame ${arrival}`);
        let index = this.inFlight.length;
        while (index > 0 && (this.inFlight[index - 1]?.arrival ?? 0) > arrival) index--;
        this.inFlight.splice(index, 0, { arrival, message });
      }
      return;
    }
    for (let delivered = 0; this.network.length > 0; delivered++) {
      if (delivered > MAX_MESSAGES_PER_FLUSH) throw new Error("synchronized messages never settle");
      const message = this.network.shift();
      if (message !== undefined) for (const client of this.clients) client.deliverSync(message);
    }
  }

  /** Delivers the messages due at the current frame, before its callbacks, as Warcraft runs a turn's events first. */
  private arrive(): void {
    while ((this.inFlight[0]?.arrival ?? this.frame + 1) <= this.frame) {
      const due = this.inFlight.shift();
      if (due !== undefined) for (const client of this.clients) client.deliverSync(due.message);
    }
    this.flush();
  }

  frames(count: number): void {
    for (let frame = 0; frame < count; frame++) {
      this.frame++;
      this.arrive();
      for (const client of this.clients) client.step();
      this.flush();
    }
  }

  chat(sender: number, message: string): void {
    for (const client of this.clients) client.chat(sender, message);
    this.flush();
  }

  /** A key press and release with modifiers (2: Ctrl), as every client sees it. */
  press(sender: number, key: number, meta = 0): void {
    for (const down of [true, false]) {
      for (const client of this.clients) client.key(sender, key, meta, down);
      this.flush();
    }
  }

  /** Puts a file in every client's CustomMapData, as the host writes it: one chunk per FileIO tooltip level. */
  publish(name: string, chunks: readonly string[]): void {
    for (const client of this.clients) client.published.set(name, chunks);
  }

  /** Puts the host's marker in every client's hot folder, as `wisp fresh` and `wisp hot` do before anything else. */
  prepareHostFolder(): void {
    for (const client of this.clients) client.published.set(hostFile(this.options.filePrefix), ["host"]);
  }

  /**
   * Publishes the bundle as the next hot reload version, as `wisp hot` does:
   * the host's marker, payload files, then the manifest. The clients find it on their next polls.
   */
  reload(): number {
    this.prepareHostFolder();
    const text = this.options.bundle;
    const prefix = this.options.filePrefix;
    const sum = checksum(text.length, (index) => text.charCodeAt(index));
    const files = Math.max(1, floorDiv(text.length + PAYLOAD_FILE_BYTES - 1, PAYLOAD_FILE_BYTES));
    for (let index = 0; index < files; index++) {
      this.publish(payloadFile(sum, index, prefix), [text.slice(index * PAYLOAD_FILE_BYTES, (index + 1) * PAYLOAD_FILE_BYTES)]);
    }
    this.version++;
    this.publish(manifestFile(this.version, prefix), [formatManifest({ version: this.version, files, checksum: sum })]);
    return this.version;
  }

  /** Clients whose acknowledgement doesn't name the latest version, each with why. */
  unappliedReloads(): string[] {
    if (this.version === 0) return [];
    const problems: string[] = [];
    for (const client of this.clients) {
      const acknowledgement = client.files.get(ackFile(client.slot, this.options.filePrefix))?.[0] ?? "";
      if (acknowledgement.startsWith(`applied ${this.version} at `)) continue;
      let reason = "no answer yet";
      for (const message of client.messages) if (message.startsWith(`hot reload ${this.version} not applied`)) reason = message;
      problems.push(`p${client.slot}: hot reload ${this.version} not running: ${reason}`);
    }
    return problems;
  }

  /** The first call at which two clients' logs differ, with the calls around it; undefined when they agree. */
  firstDivergence(): string | undefined {
    const first = this.clients[0];
    if (first === undefined) return undefined;
    for (let other = 1; other < this.clients.length; other++) {
      const client = this.clients[other];
      if (client === undefined) continue;
      const length = Math.max(first.log.length, client.log.length);
      for (let index = 0; index < length; index++) {
        const left = first.log[index];
        const right = client.log[index];
        if (left !== undefined && right !== undefined && sameCall(left, right)) continue;
        const context = (log: readonly { readonly name: string; readonly args: readonly unknown[] }[]) => {
          const lines: string[] = [];
          for (let at = Math.max(0, index - 4); at < Math.min(log.length, index + 2); at++) {
            const call = log[at];
            if (call !== undefined) lines.push(describeCall(call));
          }
          return lines.join("\n    ");
        };
        return `call ${index} differs between slot ${first.slot} and slot ${client.slot}:\n  slot ${first.slot}:\n    ${context(first.log)}\n  slot ${client.slot}:\n    ${context(client.log)}`;
      }
    }
    return undefined;
  }
}
