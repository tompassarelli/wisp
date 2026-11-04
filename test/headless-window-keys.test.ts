import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../host/headless/headless";
import { createKeyFeed } from "../src/headless/keyInput";
import { unpackKey } from "../host/window/keyEvents";

const runtime = installHeadless({ filePrefix: "windowKeys", globalPrefixes: ["__windowKeys"], warcraftNatives: true });
afterAll(runtime.restore);

const OSKEY_N = 0x4e, OSKEY_SEMICOLON = 186, OSKEY_Q = 0x51;
const SHIFT = 1;

test("[boundary] a window key event unpacks to its oskey, meta mask, direction and the character the press typed", () => {
  expect(unpackKey(0x4e)).toEqual({ key: OSKEY_N, meta: 0, down: false });
  expect(unpackKey(0x1000 | 0x100 | 0xba)).toEqual({ key: OSKEY_SEMICOLON, meta: SHIFT, down: true });
  expect(unpackKey(0x1000 | 0xf00 | 0xff)).toEqual({ key: 0xff, meta: 0xf, down: true });
  expect(unpackKey(0x1000 | 0x41 | 0x41 << 13)).toEqual({ key: 0x41, meta: 0, down: true, typed: "A" });
  expect(unpackKey(0x1000 | 0x45 | 0xe9 << 13)).toEqual({ key: 0x45, meta: 0, down: true, typed: "é" });
  expect(unpackKey(0x1000 | 0x41 | 0x1f600 * (1 << 13))).toEqual({ key: 0x41, meta: 0, down: true, typed: "😀" });
});

test("[scenario] window keys reach the triggers registered for that player, key, meta and direction, in order, and no other", () => {
  const heard: string[] = [];
  const map = { install: () => {}, start: () => {
    const register = (name: string, key: number, meta: number, down: boolean) => {
      const trigger = CreateTrigger();
      BlzTriggerRegisterPlayerKeyEvent(trigger, Player(0), ConvertOsKeyType(key), meta, down);
      TriggerAddAction(trigger, () => { heard.push(`${name} ${GetPlayerId(GetTriggerPlayer())} ${BlzGetTriggerPlayerKey() as unknown as number}`); });
    };
    register("n down", OSKEY_N, 0, true);
    register("n up", OSKEY_N, 0, false);
    register("semicolon down", OSKEY_SEMICOLON, 0, true);
    register("shift q down", OSKEY_Q, SHIFT, true);
  } };
  const clients = runtime.clients(map, [0]);
  clients.start();
  clients.frames(2);
  const feed = createKeyFeed(clients, 0);
  const other = createKeyFeed(clients, 1);

  feed([{ key: OSKEY_N, meta: 0, down: true }, { key: OSKEY_SEMICOLON, meta: 0, down: true }, { key: OSKEY_N, meta: 0, down: false }]);
  clients.frames(1);
  expect(heard).toEqual(["n down 0 78", "semicolon down 0 186", "n up 0 78"]);

  heard.length = 0;
  feed([{ key: OSKEY_Q, meta: 0, down: true }, { key: OSKEY_Q, meta: SHIFT, down: true }]);
  other([{ key: OSKEY_N, meta: 0, down: true }]);
  clients.frames(1);
  expect(heard).toEqual(["shift q down 0 81"]);
});

const ENTER = 0x0d, ESCAPE = 0x1b, BACKSPACE = 0x08, SPACE = 0x20, OSKEY_W = 0x57;
const packed = (key: number, down: boolean, typed?: string) => key | (down ? 1 << 12 : 0) | (typed === undefined ? 0 : (typed.codePointAt(0) ?? 0) * (1 << 13));
const tap = (key: number, typed?: string) => [packed(key, true, typed), packed(key, false)];
const typing = (text: string) => Array.from(text).flatMap((character) => tap(character === " " ? SPACE : character.toUpperCase().charCodeAt(0), character));

test("[scenario] in the native window Enter opens the chat line, typing fills it and Enter sends it as one chat event from the local player on every client, Escape sends none, and the game hears no key while the line is open", () => {
  const chats: string[] = [], keys: string[] = [];
  const map = { install: () => {}, start: () => {
    const said = CreateTrigger();
    TriggerRegisterPlayerChatEvent(said, Player(0), "", false);
    TriggerAddAction(said, () => { chats.push(`client ${GetPlayerId(GetLocalPlayer())} heard ${GetPlayerId(GetTriggerPlayer())}: ${GetEventPlayerChatString()}`); });
    const pressed = CreateTrigger();
    for (let key = 1; key <= 255; key++) for (const down of [true, false]) BlzTriggerRegisterPlayerKeyEvent(pressed, Player(0), ConvertOsKeyType(key), 0, down);
    TriggerAddAction(pressed, () => { if (GetPlayerId(GetLocalPlayer()) === 0) keys.push(`${BlzGetTriggerPlayerKey() as unknown as number}`); });
  } };
  const clients = runtime.clients(map, [0, 1]);
  clients.start();
  clients.frames(2);
  const feed = createKeyFeed(clients, 0);
  const window = (events: readonly number[]) => feed(events.map(unpackKey));
  const entry = clients.client(0).chatEntry;

  window([packed(OSKEY_W, true), ...tap(ENTER), ...typing("hi therx"), ...tap(BACKSPACE), ...typing("e"), packed(OSKEY_W, false)]);
  expect(entry.text).toBe("hi there");
  expect(clients.client(1).chatEntry.text).toBeUndefined();
  window(tap(ENTER));
  clients.frames(1);
  expect(entry.text).toBeUndefined();
  expect(chats).toEqual(["client 0 heard 0: hi there", "client 1 heard 0: hi there"]);
  expect(keys).toEqual([`${OSKEY_W}`, `${OSKEY_W}`]);

  chats.length = 0;
  keys.length = 0;
  window([...tap(ENTER), ...typing("never sent"), ...tap(ESCAPE), ...tap(ENTER), ...tap(ENTER)]);
  clients.frames(1);
  expect(chats).toEqual([]);
  expect(keys).toEqual([]);
  expect(entry.text).toBeUndefined();

  window(tap(OSKEY_N));
  clients.frames(1);
  expect(keys).toEqual([`${OSKEY_N}`, `${OSKEY_N}`]);
});
