// Simulated clients in lockstep (wisp:docs/headless.md). The clients take turns
// running the same map code, one frame at a time, and every synchronized
// event (chat, keys, sync data any client sends) reaches every client in the
// same order, so clients that took the same events must make the same native
// calls. A hot reload goes through the map's own reloader, from the files the
// host would write. Runtime-neutral, like client.ts.
import { ackFile, formatManifest, hostFile, manifestFile } from "../runtime/gameFiles";
import type { FrameTemplate } from "./frames";
import { type Hash, type ModuleSet, ModulePublisher, type VersionFiles } from "../runtime/modules";
import { type ClientFiles, type ClientScope, HeadlessClient, type LocalNatives, type MapEntry, type NativeBehaviors, type SyncMessage, WISP_LOCAL_NATIVES, describeCall, sameCall } from "./client";
import type { NativeDeclarations } from "./declarations";
import type { UnitStateFixtures } from "./client";
import type { IntentionalNoops } from "./client";
import type { SceneryFixtures } from "./warcraft3Scenery";
import type { Warcraft3InventoryFixtures } from "./warcraft3Inventory";

export interface LockstepOptions {
  readonly unitStates?: UnitStateFixtures;
  readonly scenery?: SceneryFixtures;
  readonly inventory?: Warcraft3InventoryFixtures;
  readonly declarations: NativeDeclarations;
  /** One client per human player slot. */
  readonly players: readonly number[];
  /** The map's configureRuntime() filePrefix, which names its reload, acknowledgement and error files. */
  readonly filePrefix: string;
  /** Each client's map entry; called in that client, so a host can load the bundle there. */
  readonly entry: (this: void, client: HeadlessClient) => MapEntry;
  /** The modules a hot reload publishes; each client's `load` turns their texts back into chunks. */
  readonly modules: ModuleSet;
  /** The checksum the host computes over module texts and indexes; the runtime-neutral one by default. */
  readonly hash?: Hash;
  /** The game's local-only natives, added to WISP_LOCAL_NATIVES. */
  readonly localNatives?: LocalNatives;
  readonly intentionalNoops?: IntentionalNoops;
  readonly natives?: (this: void, client: HeadlessClient) => NativeBehaviors;
  readonly scope?: ClientScope;
  /** When synchronized messages arrive; without it, each arrives before the next frame. */
  readonly delivery?: SyncDelivery;
  /** A player's CustomMapData outside the process, for clients whose files another program reads and writes. */
  readonly files?: (this: void, slot: number) => ClientFiles | undefined;
  /**
   * Compare the clients' calls after every frame and keep only this many of
   * each log, for the context of a later desync, so a long run keeps its memory.
   */
  readonly keepCalls?: number;
  /**
   * A clock, such as process CPU milliseconds: with it, `costs` holds what
   * each client's last frame took, its arriving messages and its callbacks.
   */
  readonly cost?: (this: void) => number;
  /** Frame definitions (wisp:docs/ui.md) whose trees BlzCreateFrame makes by name, as their generated FDF does in Warcraft. */
  readonly frames?: readonly FrameTemplate[];
}

/**
 * When a synchronized message reaches the clients, such as the measured
 * Battle.net latency of wisp:src/headless/syncChannel.ts
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

/** The key a typed character presses outside an edit box, with its modifiers (1: Shift); undefined for one with no key. */
function typedKey(code: number): readonly [key: number, meta: number] | undefined {
  // a-z: Warcraft's key codes are the capital letters'.
  if (code >= 97 && code <= 122) return [code - 32, 0];
  if (code >= 65 && code <= 90) return [code, 1];
  if ((code >= 48 && code <= 57) || code === 32) return [code, 0];
  return undefined;
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
  /** The files of the latest version, as the host wrote them. */
  files: VersionFiles | undefined = undefined;
  /** With a delivery: messages sent and not yet received, by arrival frame, then send order. */
  readonly inFlight: InFlight[] = [];
  /** With a `cost` clock: each client's last frame, in the clock's units, by client index. */
  readonly costs: number[] = [];
  private readonly options: LockstepOptions;
  /** The first desync, once a comparison after a frame found one. */
  private divergence: string | undefined;
  private readonly publisher: ModulePublisher;

  constructor(options: LockstepOptions) {
    this.options = options;
    this.publisher = new ModulePublisher(options.filePrefix, options.hash);
    const localNatives = { ...WISP_LOCAL_NATIVES, ...options.localNatives };
    const clients: HeadlessClient[] = [];
    for (let index = 0; index < options.players.length; index++) {
      const slot = options.players[index] ?? index;
      const files = options.files?.(slot);
      clients.push(new HeadlessClient({
        slot,
        filePrefix: options.filePrefix,
        humans: options.players,
        declarations: options.declarations,
        localNatives,
        ...(options.intentionalNoops === undefined ? {} : { intentionalNoops: options.intentionalNoops }),
        network: this.network,
        // Different screens, so layout that depends on the local screen is exercised.
        screenWidth: 1920 + 640 * index,
        ...(options.scope === undefined ? {} : { scope: options.scope }),
        ...(options.natives === undefined ? {} : { natives: options.natives }),
        ...(files === undefined ? {} : { files }),
        ...(options.frames === undefined ? {} : { frames: options.frames }),
        ...(options.unitStates === undefined ? {} : { unitStates: options.unitStates }),
        ...(options.scenery === undefined ? {} : { scenery: options.scenery }),
        ...(options.inventory === undefined ? {} : { inventory: options.inventory }),
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
      if (due === undefined) continue;
      for (let index = 0; index < this.clients.length; index++) {
        const started = this.options.cost?.();
        this.clients[index]?.deliverSync(due.message);
        this.charge(index, started);
      }
    }
    this.flush();
  }

  frames(count: number): void {
    for (let frame = 0; frame < count; frame++) {
      this.frame++;
      for (let index = 0; index < this.clients.length; index++) this.costs[index] = 0;
      this.arrive();
      for (let index = 0; index < this.clients.length; index++) {
        const started = this.options.cost?.();
        this.clients[index]?.step();
        this.charge(index, started);
      }
      this.flush();
      this.settle();
    }
  }

  /** Adds the cost clock's time since `started` to a client's frame. */
  private charge(index: number, started: number | undefined): void {
    const clock = this.options.cost;
    if (clock !== undefined && started !== undefined) this.costs[index] = (this.costs[index] ?? 0) + clock() - started;
  }

  /**
   * With keepCalls, compares the clients' calls so far, keeps the first
   * desync with the frame it was found after, and forgets all but the last
   * keepCalls of each log.
   */
  private settle(): void {
    const keep = this.options.keepCalls;
    if (keep === undefined) return;
    if (this.divergence === undefined) {
      const divergence = this.compare();
      if (divergence !== undefined) this.divergence = `after frame ${this.frame}, ${divergence}`;
    }
    for (const client of this.clients) if (client.log.length > keep) client.forget(client.log.length - keep);
  }

  chat(sender: number, message: string): void {
    for (const client of this.clients) client.chat(sender, message);
    this.flush();
  }

  /** A key press and release with modifiers (2: Ctrl), as every client sees it. */
  press(sender: number, key: number, meta = 0): void {
    for (const down of [true, false]) this.key(sender, key, meta, down);
  }

  /** A held key's press or release, delivered to every client before its next frame. */
  key(sender: number, key: number, meta: number, down: boolean): void {
    for (const client of this.clients) client.key(sender, key, meta, down);
    this.flush();
  }

  /** The client of a player slot. */
  client(slot: number): HeadlessClient {
    for (const client of this.clients) if (client.slot === slot) return client;
    throw new Error(`no client plays slot ${slot}`);
  }

  /**
   * Text a player's keyboard types, such as an input helper's: into the edit
   * box that has their keyboard, local to their client, or, without one, as a
   * press and release of each character's key, which every client sees.
   */
  type(sender: number, text: string): void {
    if (this.client(sender).type(text)) return;
    for (let index = 0; index < text.length; index++) {
      const key = typedKey(text.charCodeAt(index));
      if (key === undefined) throw new Error(`no key types "${text.charAt(index)}" outside an edit box`);
      this.press(sender, key[0], key[1]);
    }
  }

  /**
   * A player's click at (x, y) in Warcraft's UI coordinates: the frame under
   * it on their client takes the keyboard, and every client sees the click.
   * False when no frame there takes clicks.
   */
  click(sender: number, x: number, y: number): boolean {
    const clicker = this.client(sender);
    const frame = clicker.clickTarget(x, y);
    if (frame === undefined) return false;
    clicker.frames.focus(frame, true);
    const click = clicker.natives.FRAMEEVENT_CONTROL_CLICK;
    for (const client of this.clients) client.frameEvent(sender, frame.id, click);
    this.flush();
    return true;
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
   * Publishes the map's modules, or `modules`, as the next hot reload version,
   * as `wisp hot` does: the host's marker, payload files, then the manifest.
   * When every client acknowledged the previous version, it offers a delta
   * from that state. The clients find it on their next polls.
   */
  reload(modules: ModuleSet = this.options.modules): number {
    this.prepareHostFolder();
    const previous = this.files;
    if (previous !== undefined && this.unappliedReloads().length === 0) this.publisher.installed(previous.published);
    this.version++;
    const files = this.publisher.files(this.version, modules);
    for (const [name, text] of files.payloads) this.publish(name, [text]);
    this.publish(manifestFile(this.version, this.options.filePrefix), [formatManifest(files.manifest)]);
    this.files = files;
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
    return this.divergence ?? this.compare();
  }

  private compare(): string | undefined {
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
        return `call ${first.forgotten + index} differs between slot ${first.slot} and slot ${client.slot}:\n  slot ${first.slot}:\n    ${context(first.log)}\n  slot ${client.slot}:\n    ${context(client.log)}`;
      }
    }
    return undefined;
  }
}
