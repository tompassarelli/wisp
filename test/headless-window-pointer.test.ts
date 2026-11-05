import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../host/headless/headless";
import { type PointerReading, screenPoint, uiPoint } from "../src/headless/pointer";

const runtime = installHeadless({ filePrefix: "windowPointer", globalPrefixes: ["__windowPointer"] });
afterAll(runtime.restore);

const WINDOW = { width: 1600, height: 900 };
const reading = (x: number, y: number, rest: Partial<PointerReading> = {}): PointerReading => ({ x, y, ...WINDOW, inside: true, held: 0, pressed: 0, released: 0, ...rest });

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
