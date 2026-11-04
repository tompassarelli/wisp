import { afterAll, expect, test } from "bun:test";
import { createTimer, startTimer } from "wisp/game/clock";
import { createEvents, onEvents } from "wisp/game/events";
import { FrameEvent, FramePoint, OriginFrame, addFrameEvent, createFrameByType, eventFrameEvent, eventFrameValue, originFrame, setFrameAbsPoint, setFrameSize } from "wisp/game/frames";
import { eventPlayer, localPlayer, playerSlot } from "wisp/game/players";
import { installHeadless } from "../host/headless/headless";
import { POINTER_LEFT, createPointerFeed, uiPoint } from "../src/headless/pointer";
import { type PointerStep, pointerStep, scriptedPointer, uiReading } from "../src/headless/pointerScript";

const runtime = installHeadless({ filePrefix: "pointerScript", globalPrefixes: ["__pointerScript"] });
afterAll(runtime.restore);

const steps = (script: string): PointerStep[] => script.split("\n").flatMap((line) => {
  const [frame = "", , action = "", ...args] = line.trim().split(/\s+/);
  const step = pointerStep(Number(frame), action, args);
  return step === undefined ? [] : [step];
});

function play(script: string, frames: number): string[] {
  const clicked: string[] = [];
  const map = { install: () => {}, start: () => {
    const card = createFrameByType("BUTTON", "card", originFrame(OriginFrame.gameUi, 0), "", 0);
    setFrameAbsPoint(card, FramePoint.center, 0.3, 0.2);
    setFrameSize(card, 0.1, 0.1);
    const trigger = createEvents();
    addFrameEvent(trigger, card, FrameEvent.controlClick);
    onEvents(trigger, () => { clicked.push(`card ${playerSlot(eventPlayer())} ${localPlayer() === eventPlayer()}`); });
  } };
  const clients = runtime.clients(map, [0]);
  clients.start();
  const pointer = scriptedPointer(steps(script));
  const feed = createPointerFeed(clients, 0);
  for (let frame = 0; frame < frames; frame++) {
    const reading = pointer(frame);
    if (reading !== undefined) feed(reading);
    clients.frames(1);
  }
  expect(clients.clients.map((client) => client.errors)).toEqual([[]]);
  return clicked;
}

test("[scenario] a scripted pad clicks the frame under the pointer on the frame it names, and nothing moves without the step", () => {
  const onCard = "10 a pointer 0.3 0.2\n12 a click 0.3 0.2";
  expect(play(onCard, 8)).toEqual([]);
  expect(play(onCard, 30)).toEqual(["card 0 true"]);
  expect(play("12 a click 0.7 0.5", 30)).toEqual([]);
  expect(play("1 a stick 1 0", 30)).toEqual([]);
});

test("a click presses on its frame and lets go FRAMES later, and the cursor stays where the script put it", () => {
  const pointer = scriptedPointer(steps("5 a click 0.3 0.2 3\n20 a pointer 0.1 0.1"));
  const readings = Array.from({ length: 22 }, (_, frame) => pointer(frame));
  expect(readings[4]).toBeUndefined();
  expect(readings[5]).toMatchObject({ held: POINTER_LEFT, pressed: POINTER_LEFT, released: 0 });
  expect(readings[7]).toMatchObject({ held: POINTER_LEFT, pressed: 0, released: 0 });
  expect(readings[8]).toMatchObject({ held: 0, pressed: 0, released: POINTER_LEFT });
  expect(readings[9]).toMatchObject({ held: 0, pressed: 0, released: 0 });
  const at = uiPoint(readings[9]!);
  expect([at.x, at.y]).toEqual([expect.closeTo(0.3, 6), expect.closeTo(0.2, 6)]);
  const moved = uiPoint(readings[21]!);
  expect([moved.x, moved.y]).toEqual([expect.closeTo(0.1, 6), expect.closeTo(0.1, 6)]);
  const centre = uiReading(0.4, 0.3);
  expect([centre.x, centre.y]).toEqual([expect.closeTo(800, 3), expect.closeTo(600, 3)]);
});

test("a pointer step ignores other pad actions and refuses a point off Warcraft's screen", () => {
  expect(pointerStep(1, "stick", ["1", "0"])).toBeUndefined();
  expect(() => pointerStep(1, "click", ["0.9", "0.2"])).toThrow("pointer X runs 0..0.8");
  expect(() => pointerStep(1, "click", ["0.3", "0.2", "0"])).toThrow("click FRAMES runs 1..600");
  expect(() => pointerStep(1, "pointer", ["0.3"])).toThrow("pointer Y runs 0..0.6");
});

function wheelPlay(script: string, frames: number, registered = true): { seen: string[]; outside: number[] } {
  const seen: string[] = [];
  const outside: number[] = [];
  const map = { install: () => {}, start: () => {
    const list = createFrameByType("BUTTON", "list", originFrame(OriginFrame.gameUi, 0), "", 0);
    setFrameAbsPoint(list, FramePoint.center, 0.3, 0.2);
    setFrameSize(list, 0.1, 0.1);
    const trigger = createEvents();
    addFrameEvent(trigger, list, registered ? FrameEvent.mouseWheel : FrameEvent.controlClick);
    onEvents(trigger, () => { seen.push(`${eventFrameValue()} ${playerSlot(eventPlayer())} ${eventFrameEvent() === FrameEvent.mouseWheel}`); });
    startTimer(createTimer(), 1 / 60, true, () => { outside.push(eventFrameValue()); });
  } };
  const clients = runtime.clients(map, [0]);
  clients.start();
  const pointer = scriptedPointer(steps(script));
  const feed = createPointerFeed(clients, 0);
  for (let frame = 0; frame < frames; frame++) {
    const reading = pointer(frame);
    if (reading !== undefined) feed(reading);
    clients.frames(1);
  }
  expect(clients.clients.map((client) => client.errors)).toEqual([[]]);
  return { seen, outside };
}

const wheelValues = (script: string, frames: number, registered = true) => wheelPlay(script, frames, registered).seen;

test("[scenario] a scripted wheel turns over a frame that registered the wheel event once per notch with 120 away from the user and -120 toward, sent through the lockstep", () => {
  expect(wheelValues("10 a wheel 0.3 0.2 1", 30)).toEqual(["120 0 true"]);
  expect(wheelValues("10 a wheel 0.3 0.2 -3", 30)).toEqual(["-120 0 true", "-120 0 true", "-120 0 true"]);
  expect(wheelValues("10 a wheel 0.3 0.2 2\n12 a wheel 0.3 0.2 -1", 30)).toEqual(["120 0 true", "120 0 true", "-120 0 true"]);
});

test("a wheel turn off the frame, over a frame that did not register it, or with no step reaches no handler, and a handler reads 0 outside a wheel event", () => {
  expect(wheelValues("10 a wheel 0.7 0.5 1", 30)).toEqual([]);
  expect(wheelValues("10 a wheel 0.3 0.2 1", 30, false)).toEqual([]);
  expect(wheelValues("10 a pointer 0.3 0.2", 30)).toEqual([]);
  const played = wheelPlay("10 a wheel 0.3 0.2 1", 30);
  expect(played.seen).toEqual(["120 0 true"]);
  expect(played.outside.length).toBeGreaterThan(20);
  expect(played.outside.every((value) => value === 0)).toBe(true);
});

test("a wheel step is a whole nonzero number of notches on Warcraft's screen and reaches the reading on its frame only", () => {
  expect(() => pointerStep(1, "wheel", ["0.3", "0.2"])).toThrow("wheel DELTA");
  expect(() => pointerStep(1, "wheel", ["0.3", "0.2", "0"])).toThrow("wheel DELTA");
  expect(() => pointerStep(1, "wheel", ["0.3", "0.2", "1.5"])).toThrow("wheel DELTA");
  expect(() => pointerStep(1, "wheel", ["0.3", "0.2", "9"])).toThrow("wheel DELTA");
  expect(() => pointerStep(1, "wheel", ["0.9", "0.2", "1"])).toThrow("pointer X runs 0..0.8");
  const pointer = scriptedPointer(steps("5 a wheel 0.3 0.2 -2"));
  expect(pointer(4)).toBeUndefined();
  expect(pointer(5)?.wheel).toBe(-2);
  expect(pointer(6)?.wheel).toBeUndefined();
});
