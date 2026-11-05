import { expect, test } from "bun:test";
import * as nativeEvents from "../src/game/native/events";
import * as nativeInput from "../src/game/native/input";
import { bindWorld } from "../src/game/native/world";
import { HeadlessClient } from "../src/headless/client";
import { readNativeDeclarations } from "../host/headless/headless";
import { registerChatEvents, registerChatHistoryKey } from "../src/ui/chatPanel";

test("[boundary] the chat panel's registrations run on Bun over the native backend and register each slot", () => {
  const client = new HeadlessClient({ screen: { width: 1920, height: 1080 }, slot: 0, humans: [0, 1], declarations: readNativeDeclarations(), filePrefix: "game-api", localNatives: {}, network: [] });
  bindWorld(client.world);
  const events = nativeEvents.createEvents();
  registerChatEvents(events, [0, 1]);
  registerChatHistoryKey(events, [1], nativeInput.osKey(119));
  bindWorld(undefined);
  expect(client.log.map(call => call.name)).toEqual(["CreateTrigger", "Player", "TriggerRegisterPlayerChatEvent", "Player", "TriggerRegisterPlayerChatEvent", "ConvertOsKeyType", "Player", "BlzTriggerRegisterPlayerKeyEvent"]);
  expect([...client.emulatedCalls.keys()]).toEqual([]);
});
