import { f32 } from "../sim/f32";
import { assertEquals, test } from "../runtime/testing";
import {
  FRIZ_QUADRATA_WIDTHS,
  textWidth,
  wrapChat,
} from "./chatLog";

test("[reference] chat: Friz Quadrata widths never fall short of the widths measured natively, so no row overruns its frame", () => {
  const measured: [string, number][] = [
    ["Tompas: okay this works test is a bit choppy", f32(20.64)],
    ["but i just watned to see if i type a", f32(15.5)],
    ["long msg how it works", f32(10.53)],
    ["Player 2: okay this works test is a bit choppy but", f32(26.05)],
    ["wanted to see if i type a long message how it", f32(24.74)],
    ["across the panel", f32(8.75)],
    ["Player 1: gg", f32(6.23)],
    ["Player 2: picking a stage now, this message is long on purpose so", f32(35.6)],
    ["at least twice inside the wider stage panel and stays readable", f32(33.39)],
    ["Player 1: nice", f32(7.04)],
  ];
  for (const [text, width] of measured) assertEquals(textWidth(text, FRIZ_QUADRATA_WIDTHS) >= f32(width * f32(1.05)), true);
  const pieces = wrapChat("okay this works test is a bit choppy but i just watned to see if i type a long msg how it works", 18.0, 24.0, FRIZ_QUADRATA_WIDTHS);
  for (let index = 0; index < pieces.length; index++) assertEquals(textWidth(pieces[index] ?? "", FRIZ_QUADRATA_WIDTHS) <= (index === 0 ? 18.0 : 24.0), true);
  assertEquals(pieces.join(" "), "okay this works test is a bit choppy but i just watned to see if i type a long msg how it works");
});
