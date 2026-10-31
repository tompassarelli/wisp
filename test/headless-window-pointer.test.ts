import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../host/headless/headless";
import { POINTER_LEFT, POINTER_RIGHT, type PointerReading, createPointerFeed, screenPoint, uiPoint } from "../src/headless/pointer";

const runtime = installHeadless({ filePrefix: "windowPointer", globalPrefixes: ["__windowPointer"] });
afterAll(runtime.restore);

const WINDOW = { width: 1600, height: 900 };
const reading = (x: number, y: number, rest: Partial<PointerReading> = {}): PointerReading => ({ x, y, ...WINDOW, inside: true, held: 0, pressed: 0, released: 0, ...rest });
const pixelsOf = (uiX: number, uiY: number) => ({ x: uiX / 0.8 * WINDOW.width, y: (0.6 - uiY) / 0.6 * WINDOW.height });

test("the window's pixels map across the whole UI screen and into the client's screen as the game's pointerX and pointerY read them", () => {
  const centre = uiPoint(reading(800, 450));
  expect(centre.x).toBeCloseTo(0.4, 6);
  expect(centre.y).toBeCloseTo(0.3, 6);
  const corner = uiPoint(reading(0, 0));
  expect(corner.x).toBeCloseTo(0, 6);
  expect(corner.y).toBeCloseTo(0.6, 6);
  expect(screenPoint(reading(800, 450), { width: 1920, height: 1080 })).toEqual({ x: 960, y: 540 });
  expect(screenPoint(reading(0, 0), { width: 1920, height: 1080 })).toEqual({ x: 240, y: 0 });
  const pointerX = (pixel: number, width: number, height: number) => (pixel - (width - height * 4 / 3) / 2) * 0.6 / height;
  expect(pointerX(screenPoint(reading(1200, 450), { width: 2560, height: 1080 }).x, 2560, 1080)).toBeCloseTo(uiPoint(reading(1200, 450)).x, 3);
});

test("[scenario] a window click reaches only the topmost of two overlapping buttons, the mouse natives follow the cursor, and a press that leaves the button clicks nothing", () => {
  const clicked: string[] = [];
  const seen: { player: number; x: number; y: number; left: boolean; right: boolean }[] = [];
  const latest = () => seen.filter(row => row.player === 0).map(({ player: _, ...rest }) => rest).at(-1);
  const map = { install: () => {}, start: () => {
    const make = (name: string, x: number, level: number) => {
      const button = BlzCreateFrameByType("BUTTON", name, BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0), "", 0);
      BlzFrameSetAbsPoint(button, FRAMEPOINT_CENTER, x, 0.3);
      BlzFrameSetSize(button, 0.2, 0.2);
      BlzFrameSetLevel(button, level);
      const trigger = CreateTrigger();
      BlzTriggerRegisterFrameEvent(trigger, button, FRAMEEVENT_CONTROL_CLICK);
      TriggerAddAction(trigger, () => { clicked.push(`${name} ${GetPlayerId(GetTriggerPlayer())}`); });
    };
    make("high", 0.35, 5);
    make("low", 0.45, 1);
    TimerStart(CreateTimer(), 1 / 60, true, () => {
      seen.push({ player: GetPlayerId(GetLocalPlayer()), x: BlzGetMouseScreenPosX(), y: BlzGetMouseScreenPosY(), left: BlzIsMouseButtonPressed(MOUSE_BUTTON_TYPE_LEFT), right: BlzIsMouseButtonPressed(MOUSE_BUTTON_TYPE_RIGHT) });
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
  expect(last).toEqual({ x: Math.round(100 / 1600 * 1440 + 240), y: Math.round(200 / 900 * 1080), left: false, right: true });
  feed(reading(100, 200, { inside: false, held: POINTER_RIGHT }));
  clients.frames(1);
  expect(latest()).toEqual(last);
  expect(clients.clients.map(client => client.errors)).toEqual([[], []]);
});
