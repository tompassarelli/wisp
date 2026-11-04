import { afterAll, expect, test } from "bun:test";
import { createTimer, startTimer } from "wisp/game/clock";
import { createEvents, onEvents } from "wisp/game/events";
import { FrameEvent, FramePoint, OriginFrame, addFrameEvent, createFrameByType, originFrame, setFrameAbsPoint, setFrameLevel, setFrameSize } from "wisp/game/frames";
import { MouseButton, mouseDown, pointerX, pointerY } from "wisp/game/input";
import { eventPlayer, localPlayer, playerSlot } from "wisp/game/players";
import { installHeadless } from "../host/headless/headless";
import { POINTER_LEFT, POINTER_RIGHT, type PointerReading, createPointerFeed, screenPoint, uiPoint } from "../src/headless/pointer";

const runtime = installHeadless({ filePrefix: "windowPointer", globalPrefixes: ["__windowPointer"] });
afterAll(runtime.restore);

const WINDOW = { width: 1600, height: 900 };
const reading = (x: number, y: number, rest: Partial<PointerReading> = {}): PointerReading => ({ x, y, ...WINDOW, inside: true, held: 0, pressed: 0, released: 0, ...rest });
const pixelsOf = (uiX: number, uiY: number) => ({ x: WINDOW.width / 2 + (uiX - 0.4) * WINDOW.height / 0.6, y: (0.6 - uiY) * WINDOW.height / 0.6 });

test("the window's pixels map to Warcraft's 4:3 UI area centred and scaled by height, and into the client's screen as the game's pointerX and pointerY read them", () => {
  const centre = uiPoint(reading(800, 450));
  expect(centre.x).toBeCloseTo(0.4, 6);
  expect(centre.y).toBeCloseTo(0.3, 6);
  const corner = uiPoint(reading(800 - 600, 0));
  expect(corner.x).toBeCloseTo(0, 6);
  expect(corner.y).toBeCloseTo(0.6, 6);
  expect(screenPoint(reading(800, 450), { width: 1920, height: 1080 })).toEqual({ x: 960, y: 540 });
  expect(screenPoint(reading(200, 0), { width: 1280, height: 720 })).toEqual({ x: 160, y: 0 });
  const pointerX = (pixel: number, width: number, height: number) => (pixel - (width - height * 4 / 3) / 2) * 0.6 / height;
  expect(pointerX(screenPoint(reading(1200, 450), { width: 2560, height: 1080 }).x, 2560, 1080)).toBeCloseTo(uiPoint(reading(1200, 450)).x, 3);
});

test("[scenario] a window click reaches only the topmost of two overlapping buttons, the mouse natives follow the cursor, and a press that leaves the button clicks nothing", () => {
  const clicked: string[] = [];
  const seen: { player: number; x: number; y: number; left: boolean; right: boolean }[] = [];
  const latest = () => seen.filter(row => row.player === 0).map(({ player: _, ...rest }) => rest).at(-1);
  const map = { install: () => {}, start: () => {
    const make = (name: string, x: number, level: number) => {
      const button = createFrameByType("BUTTON", name, originFrame(OriginFrame.gameUi, 0), "", 0);
      setFrameAbsPoint(button, FramePoint.center, x, 0.3);
      setFrameSize(button, 0.2, 0.2);
      setFrameLevel(button, level);
      const trigger = createEvents();
      addFrameEvent(trigger, button, FrameEvent.controlClick);
      onEvents(trigger, () => { clicked.push(`${name} ${playerSlot(eventPlayer())}`); });
    };
    make("high", 0.35, 5);
    make("low", 0.45, 1);
    startTimer(createTimer(), 1 / 60, true, () => {
      seen.push({ player: playerSlot(localPlayer()), x: pointerX(), y: pointerY(), left: mouseDown(MouseButton.left), right: mouseDown(MouseButton.right) });
    });
  } };
  const clients = runtime.clients(map, [0, 1]);
  clients.start();
  clients.frames(2);
  const feed = createPointerFeed(clients, 0);
  const overlap = pixelsOf(0.4, 0.3), onlyLow = pixelsOf(0.53, 0.3), nowhere = pixelsOf(0.05, 0.05);

  feed(reading(overlap.x, overlap.y, { held: POINTER_LEFT, pressed: POINTER_LEFT }));
  clients.frames(1);
  expect(clicked).toEqual([]);
  feed(reading(overlap.x, overlap.y, { released: POINTER_LEFT }));
  clients.frames(3);
  expect(clicked).toEqual(["high 0", "high 0"]);

  clicked.length = 0;
  feed(reading(onlyLow.x, onlyLow.y, { held: POINTER_LEFT, pressed: POINTER_LEFT, released: POINTER_LEFT }));
  clients.frames(3);
  expect(clicked).toEqual(["low 0", "low 0"]);

  clicked.length = 0;
  feed(reading(overlap.x, overlap.y, { held: POINTER_LEFT, pressed: POINTER_LEFT }));
  feed(reading(nowhere.x, nowhere.y, { released: POINTER_LEFT }));
  feed(reading(nowhere.x, nowhere.y, { held: POINTER_LEFT, pressed: POINTER_LEFT, released: POINTER_LEFT }));
  clients.frames(3);
  expect(clicked).toEqual([]);

  feed(reading(100, 200, { held: POINTER_RIGHT }));
  clients.frames(1);
  const last = latest();
  expect(last).toEqual({ x: Math.round((100 - 800) * 1080 / 900 + 960), y: Math.round(200 * 1080 / 900), left: false, right: true });
  feed(reading(100, 200, { inside: false, held: POINTER_RIGHT }));
  clients.frames(1);
  expect(latest()).toEqual(last);
  expect(clients.clients.map(client => client.errors)).toEqual([[], []]);
});
