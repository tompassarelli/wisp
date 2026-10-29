import { f32 } from "../sim/f32";
import { assertEquals, test } from "../runtime/testing";
import {
  addChatLine,
  advanceChat,
  chatName,
  chatOpacity,
  colourCode,
  createChatLog,
  FRIZ_QUADRATA_WIDTHS,
  type GlyphWidths,
  lighten,
  textWidth,
  visibleChatRows,
  wrapChat,
} from "./chatLog";

const EVEN: GlyphWidths = { space: 1.0, narrow: 1.0, short: 1.0, lower: 1.0, wideLower: 1.0, upper: 1.0, wideUpper: 1.0, other: 1.0 };

test("[reference] chat: a name is coloured and a Battle.net tag is dropped", () => {
  assertEquals(colourCode(0xff0303), "|cffff0303");
  assertEquals(colourCode(0x0042ff), "|cff0042ff");
  assertEquals(chatName("Tom#1234"), "Tom");
  assertEquals(chatName("#1234"), "#1234");
  const log = createChatLog(10);
  addChatLine(log, 0x20c000, "Tom#1234", "hi");
  assertEquals(visibleChatRows(log, 5, 40.0, EVEN, 10.0)[0]?.text, "|cff20c000Tom|r: hi");
});

test("[reference] chat: lightening moves each channel toward white and keeps white white", () => {
  assertEquals(colourCode(lighten(0xff0303, 50)), "|cffff8181");
  assertEquals(colourCode(lighten(0x0042ff, 50)), "|cff7fa0ff");
  assertEquals(lighten(0xffffff, 50), 0xffffff);
  assertEquals(lighten(0x123456, 0), 0x123456);
});

test("[reference] chat: wrapping breaks at spaces, cuts a word wider than the row and starts later rows at the left edge", () => {
  assertEquals(wrapChat("aaa bbb ccc", 7.0, 7.0, EVEN).join("|"), "aaa bbb|ccc");
  assertEquals(wrapChat("aaa bbb ccc", 3.0, 7.0, EVEN).join("|"), "aaa|bbb ccc");
  assertEquals(wrapChat("abcdefghij", 4.0, 4.0, EVEN).join("|"), "abcd|efgh|ij");
  assertEquals(wrapChat("", 4.0, 4.0, EVEN).join("|"), "");
  const log = createChatLog(10);
  addChatLine(log, 0, "Al", "one two three four five six seven eight");
  const rows = visibleChatRows(log, 10, 20.0, EVEN, -1.0);
  assertEquals(rows.map(row => row.text).join("|"), "|cff000000Al|r: one two three|four five six seven|eight");
});

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

test("[reference] chat: lines leave the recent view in order and the history keeps them", () => {
  const log = createChatLog(3);
  for (const name of ["a", "b", "c", "d"]) {
    addChatLine(log, 0, name, name);
    advanceChat(log, 5.0);
  }
  assertEquals(log.lines.length, 3);
  assertEquals(visibleChatRows(log, 10, 40.0, EVEN, -1.0).length, 3);
  assertEquals(visibleChatRows(log, 10, 40.0, EVEN, 11.0).length, 2);
  assertEquals(visibleChatRows(log, 1, 40.0, EVEN, 11.0)[0]?.text.endsWith("d"), true);
  assertEquals(visibleChatRows(log, 10, 40.0, EVEN, 4.0).length, 0);
});

test("[reference] chat: opacity holds then ramps down over the fade", () => {
  assertEquals(chatOpacity(0.0, 10.0, 2.0), 1.0);
  assertEquals(chatOpacity(8.0, 10.0, 2.0), 1.0);
  assertEquals(chatOpacity(9.0, 10.0, 2.0), 0.5);
  assertEquals(chatOpacity(10.0, 10.0, 2.0), 0.0);
  assertEquals(chatOpacity(500.0, -1.0, 2.0), 1.0);
});
