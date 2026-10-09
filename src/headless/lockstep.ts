





import { ackFile, formatManifest, hostFile, manifestFile } from "../runtime/gameFiles";
import type { FrameTemplate } from "./frames";
import { type Hash, type ModuleSet, ModulePublisher, type VersionFiles } from "../runtime/modules";
import { type ClientFiles, type ClientScope, HeadlessClient, type LocalNatives, type MapEntry, type NativeBehaviors, type SyncMessage, WISP_LOCAL_NATIVES, describeCall, sameCall } from "./client";
import type { NativeDeclarations } from "./declarations";
import type { EffectDeaths, UnitStateFixtures } from "./client";
import type { IntentionalNoops } from "./client";
import type { SceneryFixtures } from "./warcraft3Scenery";
import type { Warcraft3InventoryFixtures } from "./warcraft3Inventory";
import type { AbilityObjectFixtures } from "./warcraft3Abilities";

export interface LockstepOptions {
  readonly abilityObjects?: AbilityObjectFixtures;
  readonly unitStates?: UnitStateFixtures;
  readonly scenery?: SceneryFixtures;
  readonly inventory?: Warcraft3InventoryFixtures;
  readonly declarations: NativeDeclarations;

  readonly players: readonly number[];

  readonly humans?: readonly number[];

  readonly link?: LockstepLink;
  readonly playerNames?: Readonly<Record<number, string>>;

  readonly filePrefix: string;

  readonly entry: (this: void, client: HeadlessClient) => MapEntry;

  readonly modules: ModuleSet;

  readonly hash?: Hash;

  readonly localNatives?: LocalNatives;
  readonly intentionalNoops?: IntentionalNoops;
  readonly natives?: (this: void, client: HeadlessClient) => NativeBehaviors;
  readonly scope?: ClientScope;

  readonly delivery?: SyncDelivery;

  readonly files?: (this: void, slot: number) => ClientFiles | undefined;




  readonly keepCalls?: number;

  readonly effectDeaths?: EffectDeaths;

  readonly musicSlider?: number;
  readonly effectStepMs?: number;




  readonly cost?: (this: void) => number;

  readonly frames?: readonly FrameTemplate[];
}






export interface SyncDelivery {

  arrivalFrame(this: void, sender: number, frame: number, message: SyncMessage): number;
}

export type LinkEvent =
  | { readonly sender: number; readonly kind: "sync"; readonly prefix: string; readonly data: string }
  | { readonly sender: number; readonly kind: "key"; readonly key: number; readonly meta: number; readonly down: boolean }
  | { readonly sender: number; readonly kind: "chat"; readonly text: string }
  | { readonly sender: number; readonly kind: "click"; readonly frame: number };

/** Carries this process's events to the clients other processes run, each due on one frame everywhere (wisp:docs/network-model.md). */
export interface LockstepLink {
  readonly delay: number;
  sent(this: void, frame: number, event: LinkEvent): void;
  due(this: void, frame: number): readonly LinkEvent[];
}

interface InFlight {
  readonly arrival: number;
  readonly message: SyncMessage;
}


function typedKey(code: number): readonly [key: number, meta: number] | undefined {
  // a-z: Warcraft's key codes are the capital letters'.
  if (code >= 97 && code <= 122) return [code - 32, 0];
  if (code >= 65 && code <= 90) return [code, 1];
  if ((code >= 48 && code <= 57) || code === 32) return [code, 0];
  return undefined;
}


const MAX_MESSAGES_PER_FLUSH = 10000;

export class Lockstep {
  readonly network: SyncMessage[] = [];
  readonly clients: readonly HeadlessClient[];

  frame = 0;

  version = 0;

  files: VersionFiles | undefined = undefined;

  readonly inFlight: InFlight[] = [];

  readonly costs: number[] = [];
  private readonly options: LockstepOptions;

  private divergence: string | undefined;
  private inFrame = false;
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
        humans: options.humans ?? options.players,
        ...(options.playerNames === undefined ? {} : { playerNames: options.playerNames }),
        declarations: options.declarations,
        localNatives,
        ...(options.intentionalNoops === undefined ? {} : { intentionalNoops: options.intentionalNoops }),
        network: this.network,

        screenWidth: 1920 + 640 * index,
        ...(options.scope === undefined ? {} : { scope: options.scope }),
        ...(options.natives === undefined ? {} : { natives: options.natives }),
        ...(files === undefined ? {} : { files }),
        ...(options.frames === undefined ? {} : { frames: options.frames }),
        ...(options.unitStates === undefined ? {} : { unitStates: options.unitStates }),
        ...(options.abilityObjects === undefined ? {} : { abilityObjects: options.abilityObjects }),
        ...(options.scenery === undefined ? {} : { scenery: options.scenery }),
        ...(options.inventory === undefined ? {} : { inventory: options.inventory }),
        ...(options.effectDeaths === undefined ? {} : { effectDeaths: options.effectDeaths }),
        ...(options.musicSlider === undefined ? {} : { musicSlider: options.musicSlider }),
        ...(options.effectStepMs === undefined ? {} : { effectStepMs: options.effectStepMs }),
      }));
    }
    this.clients = clients;
  }






  start(options: { readonly hostFolder?: boolean } = {}): void {
    if (options.hostFolder !== false) this.prepareHostFolder();
    const entry = this.options.entry;
    for (const client of this.clients) {
      client.run(() => entry(client).start());
    }
    this.flush();
  }


  everywhere(body: (this: void) => void): void {
    for (const client of this.clients) client.run(body);
    this.flush();
  }

  /** Synchronized messages reach every client in the order they were sent, at once or at their arrival frame. */
  private flush(): void {
    if (this.options.link !== undefined) {
      for (let message = this.network.shift(); message !== undefined; message = this.network.shift()) {
        this.send({ sender: message.sender, kind: "sync", prefix: message.prefix, data: message.data });
      }
      return;
    }
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

  /** An event raised during frame n is due at n + delay; one raised between frames n and n + 1, at n + 1 + delay. */
  private send(event: LinkEvent): void {
    const link = this.options.link;
    if (link !== undefined) link.sent(this.frame + link.delay + (this.inFrame ? 0 : 1), event);
  }

  private apply(client: HeadlessClient, event: LinkEvent): void {
    if (event.kind === "sync") client.deliverSync({ sender: event.sender, prefix: event.prefix, data: event.data });
    else if (event.kind === "key") client.keyEvent(event.sender, event.key, event.meta, event.down);
    else if (event.kind === "chat") client.chat(event.sender, event.text);
    else client.frameEvent(event.sender, event.frame, client.natives.FRAMEEVENT_CONTROL_CLICK);
  }

  /** Delivers the messages due at the current frame, before its callbacks, as Warcraft runs a turn's events first. */
  private arrive(): void {
    const link = this.options.link;
    if (link !== undefined) {
      for (const event of link.due(this.frame)) {
        for (let index = 0; index < this.clients.length; index++) {
          const client = this.clients[index];
          if (client === undefined) continue;
          const started = this.options.cost?.();
          this.apply(client, event);
          this.charge(index, started);
        }
      }
      this.flush();
      return;
    }
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

  frames(count: number, options: { readonly draw?: boolean } = {}): void {
    for (let frame = 0; frame < count; frame++) {
      this.frame++;
      this.inFrame = true;
      for (let index = 0; index < this.clients.length; index++) this.costs[index] = 0;
      this.arrive();
      for (let index = 0; index < this.clients.length; index++) {
        const started = this.options.cost?.();
        this.clients[index]?.step(options.draw ?? true);
        this.charge(index, started);
      }
      this.flush();
      this.inFrame = false;
      this.settle();
    }
  }


  private charge(index: number, started: number | undefined): void {
    const clock = this.options.cost;
    if (clock !== undefined && started !== undefined) this.costs[index] = (this.costs[index] ?? 0) + clock() - started;
  }






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
    if (this.options.link !== undefined) return this.send({ sender, kind: "chat", text: message });
    for (const client of this.clients) client.chat(sender, message);
    this.flush();
  }


  press(sender: number, key: number, meta = 0): void {
    for (const down of [true, false]) this.key(sender, key, meta, down);
  }


  key(sender: number, key: number, meta: number, down: boolean): void {
    if (this.options.link !== undefined) {
      for (const client of this.clients) if (client.slot === sender) client.hold(key, meta, down);
      return this.send({ sender, kind: "key", key, meta, down });
    }
    for (const client of this.clients) client.key(sender, key, meta, down);
    this.flush();
  }


  client(slot: number): HeadlessClient {
    for (const client of this.clients) if (client.slot === slot) return client;
    throw new Error(`no client plays slot ${slot}`);
  }






  type(sender: number, text: string): void {
    if (this.client(sender).type(text)) return;
    for (let index = 0; index < text.length; index++) {
      const key = typedKey(text.charCodeAt(index));
      if (key === undefined) throw new Error(`no key types "${text.charAt(index)}" outside an edit box`);
      this.press(sender, key[0], key[1]);
    }
  }






  click(sender: number, x: number, y: number): boolean {
    const clicker = this.client(sender);
    const frame = clicker.clickTarget(x, y);
    if (frame === undefined) return false;
    clicker.frames.focus(frame, true);
    if (this.options.link !== undefined) {
      this.send({ sender, kind: "click", frame: frame.id });
      return true;
    }
    const click = clicker.natives.FRAMEEVENT_CONTROL_CLICK;
    for (const client of this.clients) client.frameEvent(sender, frame.id, click);
    this.flush();
    return true;
  }


  publish(name: string, chunks: readonly string[]): void {
    for (const client of this.clients) client.published.set(name, chunks);
  }


  prepareHostFolder(): void {
    for (const client of this.clients) client.published.set(hostFile(this.options.filePrefix), ["host"]);
  }







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
