import { assertEquals, test } from "../runtime/testing";
import { addChatLine, advanceChat, chatName, chatOpacity, colourCode, createChatLog, visibleChatRows, wrapChat } from "./chatLog";

test("[reference] chat: a name is coloured and a Battle.net tag is dropped", () => {
  assertEquals(colourCode(0xff0303), "|cffff0303");
  assertEquals(colourCode(0x0042ff), "|cff0042ff");
  assertEquals(chatName("Tom#1234"), "Tom");
  assertEquals(chatName("#1234"), "#1234");
  const log = createChatLog(10);
  addChatLine(log, 0x20c000, "Tom#1234", "hi");
  assertEquals(visibleChatRows(log, 5, 40, 10.0)[0]?.text, "|cff20c000Tom|r: hi");
});

test("[reference] chat: wrapping breaks at spaces, cuts a word longer than the row and indents under the message", () => {
  assertEquals(wrapChat("aaa bbb ccc", 7).join("|"), "aaa bbb|ccc");
  assertEquals(wrapChat("abcdefghij", 4).join("|"), "abcd|efgh|ij");
  assertEquals(wrapChat("", 4).join("|"), "");
  const log = createChatLog(10);
  addChatLine(log, 0, "Al", "one two three four five six seven eight");
  const rows = visibleChatRows(log, 10, 20, -1.0);
  assertEquals(rows.length, 3);
  assertEquals(rows[1]?.text.startsWith("    "), true);
});

test("[reference] chat: lines leave the recent view in order and the history keeps them", () => {
  const log = createChatLog(3);
  for (const name of ["a", "b", "c", "d"]) {
    addChatLine(log, 0, name, name);
    advanceChat(log, 5.0);
  }
  assertEquals(log.lines.length, 3);
  assertEquals(visibleChatRows(log, 10, 40, -1.0).length, 3);
  assertEquals(visibleChatRows(log, 10, 40, 11.0).length, 2);
  assertEquals(visibleChatRows(log, 1, 40, 11.0)[0]?.text.endsWith("d"), true);
  assertEquals(visibleChatRows(log, 10, 40, 4.0).length, 0);
});

test("[reference] chat: opacity holds then ramps down over the fade", () => {
  assertEquals(chatOpacity(0.0, 10.0, 2.0), 1.0);
  assertEquals(chatOpacity(8.0, 10.0, 2.0), 1.0);
  assertEquals(chatOpacity(9.0, 10.0, 2.0), 0.5);
  assertEquals(chatOpacity(10.0, 10.0, 2.0), 0.0);
  assertEquals(chatOpacity(500.0, -1.0, 2.0), 1.0);
});
