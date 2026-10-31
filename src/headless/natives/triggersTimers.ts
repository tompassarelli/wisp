import { divideFloat32, roundToFloat32, subtractFloat32TowardZero } from "../../sim/binary32";
import { f32 } from "../../sim/f32";
import type { Handle, HandleFactory } from "../../game/native/types";
import type { NativeBehavior, PlayerMouseInput, SyncMessage } from "../clientTypes";
import type { Frame } from "../../game/native/frameStore";
import type { EventStore } from "../../game/native/eventStore";
import { FRAMES_PER_SECOND } from "../../game/native/frameRate";
import { isFrame } from "../../game/native/frameUi";
import { type Sync, SYNC_LIMIT } from "../../game/native/syncStore";
import { after } from "./timerDeadline";
import type { Unit, Units } from "./units";

type Callback = (this: void) => void;

interface Timer extends Handle {
  callback: Callback | undefined;
  periodic: boolean;

  timeout: number;

  period: number;

  due: number;
  /** Equal deadlines run in TimerStart order; a periodic timer keeps its place. */
  order: number;
  running: boolean;
  expired: boolean;

  paused: number | undefined;
}

interface Trigger extends Handle {
  readonly actions: Callback[];
  destroyed: boolean;
  running: boolean;
  interrupted: boolean;
}

interface EventContext {
  player: number;
  syncPrefix: string;
  syncData: string;
  chat: string;
  key: number;
  mouseX: number;
  mouseY: number;
  mouseButton: unknown;
  timer: Timer | undefined;
  frame: Frame | undefined;
  frameEvent: unknown;
}

type Registration =
  | { readonly kind: "sync"; readonly trigger: Trigger; readonly player: number; readonly prefix: string }
  | { readonly kind: "chat"; readonly trigger: Trigger; readonly player: number; readonly text: string; readonly exact: boolean }
  | { readonly kind: "key"; readonly trigger: Trigger; readonly player: number; readonly key: number; readonly meta: number; readonly down: boolean }
  | { readonly kind: "player"; readonly trigger: Trigger; readonly player: number; readonly event: unknown }
  | { readonly kind: "frame"; readonly trigger: Trigger; readonly frame: Frame; readonly event: unknown };

/** One player's synchronized mouse event at world coordinates: its player event, and its button for a press or release. */
export interface PlayerMouse {
  readonly event: unknown;
  readonly x: number;
  readonly y: number;
  readonly button: unknown;
}

export function playerMouseEvent(natives: Readonly<Record<string, unknown>>, input: PlayerMouseInput): PlayerMouse {
  if (!("button" in input)) return { event: natives.EVENT_PLAYER_MOUSE_MOVE, x: input.x, y: input.y, button: undefined };
  const button = input.button === "left" ? natives.MOUSE_BUTTON_TYPE_LEFT : input.button === "middle" ? natives.MOUSE_BUTTON_TYPE_MIDDLE : natives.MOUSE_BUTTON_TYPE_RIGHT;
  return { event: input.down ? natives.EVENT_PLAYER_MOUSE_DOWN : natives.EVENT_PLAYER_MOUSE_UP, x: input.x, y: input.y, button };
}

/** The shortest repeating period: a zero period fires about 10,000 times a game second (wisp:docs/warsmash-notes.md#timers-and-frame-stepping). */
const MIN_PERIOD = f32(0.0001);

const MIN_ONE_SHOT = 0.0009765625;

const frameEnd = (frame: number): number => divideFloat32(frame, FRAMES_PER_SECOND);

export class TriggersTimers implements EventStore {
  private readonly timers: Timer[] = [];
  private readonly spellHits: { target: Unit; due: number; damage: number }[] = [];
  private timerOrder = 0;

  private now = 0;
  private readonly registrations: Registration[] = [];
  private readonly event: EventContext = { player: 0, syncPrefix: "", syncData: "", chat: "", key: 0, mouseX: 0, mouseY: 0, mouseButton: undefined, timer: undefined, frame: undefined, frameEvent: undefined };

  constructor(private readonly handle: HandleFactory, private readonly units: Units) {}

  time(): number {
    return this.now;
  }

  hit(target: Unit, due: number, damage: number): void {
    this.spellHits.push({ target, due, damage });
  }

  private fire(trigger: Trigger, event: Partial<EventContext>): void {
    if (trigger.destroyed) return;
    if (event.player !== undefined) this.event.player = event.player;
    if (event.syncPrefix !== undefined) this.event.syncPrefix = event.syncPrefix;
    if (event.syncData !== undefined) this.event.syncData = event.syncData;
    if (event.chat !== undefined) this.event.chat = event.chat;
    if (event.key !== undefined) this.event.key = event.key;
    if (event.mouseX !== undefined) this.event.mouseX = event.mouseX;
    if (event.mouseY !== undefined) this.event.mouseY = event.mouseY;
    if (event.mouseButton !== undefined) this.event.mouseButton = event.mouseButton;
    if (event.frame !== undefined) this.event.frame = event.frame;
    if (event.frameEvent !== undefined) this.event.frameEvent = event.frameEvent;
    const running = trigger.running;
    const interrupted = trigger.interrupted;
    trigger.running = true;
    trigger.interrupted = false;
    try {
      for (const action of trigger.actions) {
        if (trigger.interrupted) break;
        action();
      }
    } finally {
      trigger.running = running;
      trigger.interrupted = interrupted;
    }
  }

  private timerElapsed(timer: Timer): number {
    if (timer.paused !== undefined) return timer.paused;
    if (timer.expired) return timer.timeout;
    if (!timer.running) return 0;
    const remaining = timer.due > this.now ? subtractFloat32TowardZero(timer.due, this.now) : 0;
    return remaining < timer.period ? subtractFloat32TowardZero(timer.period, remaining) : 0;
  }

  // Due callbacks run by deadline then TimerStart order, reading their own deadline as game time.

  runDue(frame: number): void {
    const end = frameEnd(frame);
    this.now = end;
    for (;;) {
      let next: Timer | undefined;
      for (const timer of this.timers) {
        if (!timer.running || timer.callback === undefined || timer.due > end) continue;
        if (next === undefined || timer.due < next.due || (timer.due === next.due && timer.order < next.order)) next = timer;
      }
      let hitIndex = -1;
      for (let index = 0; index < this.spellHits.length; index++) {
        const hit = this.spellHits[index];
        const earliest = this.spellHits[hitIndex];
        if (hit !== undefined && hit.due <= end && (next === undefined || hit.due <= next.due) && (earliest === undefined || hit.due < earliest.due)) hitIndex = index;
      }
      const hit = this.spellHits[hitIndex];
      if (hit !== undefined) {
        this.spellHits.splice(hitIndex, 1);
        this.now = hit.due;
        this.units.strike(hit.target, hit.damage);
        continue;
      }
      if (next === undefined || next.callback === undefined) break;
      this.now = next.due;
      if (next.periodic) next.due = after(next.due, next.period);
      else {
        next.running = false;
        next.expired = true;
      }
      this.event.timer = next;
      try {
        next.callback();
      } finally {
        this.now = end;
      }
    }
  }

  deliverSync({ sender, prefix, data }: SyncMessage): void {
    for (const registration of [...this.registrations]) {
      if (registration.kind === "sync" && registration.player === sender && registration.prefix === prefix) {
        this.fire(registration.trigger, { player: sender, syncPrefix: prefix, syncData: data });
      }
    }
  }

  chat(sender: number, message: string): void {
    for (const registration of [...this.registrations]) {
      if (registration.kind !== "chat" || registration.player !== sender) continue;
      if (registration.exact ? message === registration.text : message.includes(registration.text)) this.fire(registration.trigger, { player: sender, chat: message });
    }
  }

  keyEvent(sender: number, key: number, meta: number, down: boolean): void {
    for (const registration of [...this.registrations]) {
      if (registration.kind === "key" && registration.player === sender && registration.key === key && registration.meta === meta && registration.down === down) {
        this.fire(registration.trigger, { player: sender, key });
      }
    }
  }

  playerMouse(sender: number, { event, x, y, button }: PlayerMouse): void {
    for (const registration of [...this.registrations]) {
      if (registration.kind === "player" && registration.player === sender && registration.event === event) {
        this.fire(registration.trigger, { player: sender, mouseX: roundToFloat32(x), mouseY: roundToFloat32(y), mouseButton: button });
      }
    }
  }

  frameEvent(sender: number, id: number, event: unknown): void {
    for (const registration of [...this.registrations]) {
      if (registration.kind === "frame" && registration.frame.id === id && registration.event === event) {
        this.fire(registration.trigger, { player: sender, frame: registration.frame, frameEvent: event });
      }
    }
  }

  create(): Trigger {
    return { ...this.handle("trigger"), actions: [], destroyed: false, running: false, interrupted: false };
  }

  addAction(events: Handle, handler: Callback): Handle {
    (events as Trigger).actions.push(handler);
    return this.handle("triggeraction");
  }

  destroy(events: Handle): void {
    (events as Trigger).destroyed = true;
  }

  registerFrame(events: Handle, frame: unknown, event: unknown): Handle {
    if (isFrame(frame)) this.registrations.push({ kind: "frame", trigger: events as Trigger, frame, event });
    return this.handle("event");
  }

  hasFrame(events: Handle, frame: unknown, event: unknown): boolean {
    return this.registrations.some(registration => registration.kind === "frame" && registration.trigger === events && registration.frame === frame && registration.event === event);
  }

  registerSync(events: Handle, slot: number, prefix: string): Handle {
    this.registrations.push({ kind: "sync", trigger: events as Trigger, player: slot, prefix });
    return this.handle("event");
  }

  syncData(): string {
    return this.event.syncData;
  }

  syncPrefix(): string {
    return this.event.syncPrefix;
  }

  registerLeave(events: Handle, slot: number): Handle {
    this.registrations.push({ kind: "player", trigger: events as Trigger, player: slot, event: "EVENT_PLAYER_LEAVE" });
    return this.handle("event");
  }

  triggerPlayer(): unknown {
    return this.event.player;
  }

  triggerFrame(): unknown {
    return this.event.frame;
  }

  triggerFrameEvent(): unknown {
    return this.event.frameEvent;
  }

  triggerFrameText(): string {
    return this.event.frame?.text ?? "";
  }

  handles(frame: Frame, event: unknown): boolean {
    return this.registrations.some((registration) =>
      registration.kind === "frame" && registration.frame === frame && registration.event === event && !registration.trigger.destroyed);
  }

  behaviors(sync: Sync): Readonly<Record<string, NativeBehavior>> {
    return {
      ...this.triggerBehaviors(),
      CreateTimer: (): Timer => {
        const timer: Timer = { ...this.handle("timer"), callback: undefined, periodic: false, timeout: 0, period: 0, due: 0,
          order: 0, running: false, expired: false, paused: undefined };
        this.timers.push(timer);
        return timer;
      },
      TimerStart: (timer: Timer, timeout: number, periodic: boolean, callback: Callback) => {
        const seconds = roundToFloat32(timeout);
        const shortest = periodic ? MIN_PERIOD : MIN_ONE_SHOT;
        timer.callback = callback;
        timer.periodic = periodic;
        timer.timeout = seconds;
        timer.period = seconds >= shortest ? seconds : shortest;

        timer.due = after(this.now, timer.period);
        timer.order = ++this.timerOrder;
        timer.running = true;
        timer.expired = false;
        timer.paused = undefined;
      },
      PauseTimer: (timer: Timer) => {
        if (timer.running) timer.paused = this.timerElapsed(timer);
        timer.running = false;
      },
      DestroyTimer: (timer: Timer) => {
        timer.running = false;
        const index = this.timers.indexOf(timer);
        if (index >= 0) this.timers.splice(index, 1);
      },
      TimerGetElapsed: (timer: Timer) => this.timerElapsed(timer),
      BlzSendSyncData: (prefix: string, data: string) => {
        return sync.send(prefix, data.slice(0, SYNC_LIMIT));
      },
    };
  }

  private triggerBehaviors(): Readonly<Record<string, NativeBehavior>> {
    return {
      GetTriggerPlayer: () => this.triggerPlayer(),
      BlzTriggerRegisterFrameEvent: (trigger: Trigger, frame: unknown, event: unknown) => this.registerFrame(trigger, frame, event),
      BlzGetTriggerFrame: () => this.triggerFrame(),
      BlzGetTriggerFrameEvent: () => this.triggerFrameEvent(),
      BlzGetTriggerFrameText: () => this.triggerFrameText(),
      BlzGetTriggerSyncData: () => this.syncData(),
      BlzGetTriggerSyncPrefix: () => this.syncPrefix(),
      GetEventPlayerChatString: () => this.event.chat,
      BlzGetTriggerPlayerKey: () => this.event.key,
      BlzGetTriggerPlayerMouseX: () => this.event.mouseX,
      BlzGetTriggerPlayerMouseY: () => this.event.mouseY,
      BlzGetTriggerPlayerMousePosition: () => this.units.location(this.event.mouseX, this.event.mouseY),
      BlzGetTriggerPlayerMouseButton: () => this.event.mouseButton,
      GetExpiredTimer: () => this.event.timer,
      CreateTrigger: () => this.create(),
      BlzTriggerIsRunning: (trigger: Trigger) => trigger.running,
      BlzTriggerInterrupt: (trigger: Trigger) => { trigger.interrupted = true; },
      DestroyTrigger: (trigger: Trigger) => this.destroy(trigger),
      TriggerAddAction: (trigger: Trigger, action: Callback) => this.addAction(trigger, action),
      BlzTriggerRegisterPlayerSyncEvent: (trigger: Trigger, player: number, prefix: string) => this.registerSync(trigger, player, prefix),
      TriggerRegisterPlayerChatEvent: (trigger: Trigger, player: number, text: string, exact: boolean) => {
        this.registrations.push({ kind: "chat", trigger, player, text, exact });
        return this.handle("event");
      },
      TriggerRegisterPlayerEvent: (trigger: Trigger, player: number, event: unknown) => {
        this.registrations.push({ kind: "player", trigger, player, event });
        return this.handle("event");
      },
      BlzTriggerRegisterPlayerKeyEvent: (trigger: Trigger, player: number, key: number, meta: number, down: boolean) => {
        this.registrations.push({ kind: "key", trigger, player, key, meta, down });
        return this.handle("event");
      },
    };
  }
}
