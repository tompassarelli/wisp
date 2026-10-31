import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../host/headless/headless";
import { createKeyFeed, unpackKey } from "../src/headless/keyInput";

const runtime = installHeadless({ filePrefix: "windowKeys", globalPrefixes: ["__windowKeys"] });
afterAll(runtime.restore);

const OSKEY_N = 0x4e, OSKEY_SEMICOLON = 186, OSKEY_Q = 0x51;
const SHIFT = 1;

test("[boundary] a window key event unpacks to its oskey, meta mask and direction", () => {
  expect(unpackKey(0x4e)).toEqual({ key: OSKEY_N, meta: 0, down: false });
  expect(unpackKey(0x1000 | 0x100 | 0xba)).toEqual({ key: OSKEY_SEMICOLON, meta: SHIFT, down: true });
  expect(unpackKey(0x1000 | 0xf00 | 0xff)).toEqual({ key: 0xff, meta: 0xf, down: true });
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
