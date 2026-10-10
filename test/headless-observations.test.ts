import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";
import { runJourney } from "../src/headless/journey";

const runtime = installHeadless({ filePrefix: "observations", globalPrefixes: ["__observations"], frames: [{
  name: "Pips", type: "BACKDROP", width: 0.25, height: 0.125, texture: "panel.blp", children: [{
    key: "pip", type: "BACKDROP", width: 0.0625, height: 0.0625, texture: "pip.blp",
    points: [{ point: "TOPLEFT", x: 0.0625, y: -0.03125 }],
  }],
}, {
  name: "Damage", type: "TEXT", width: 0, height: 0, text: "0.0%", font: { file: "MasterFont", size: 0.036, flags: 1 },
  justify: { horizontal: "LEFT", vertical: "MIDDLE" }, children: [],
}] });
afterAll(runtime.restore);

test("journey observations run after all same-frame events without changing calls or checksums", () => {
  const map = { start: () => {
    const trigger = CreateTrigger();
    TriggerRegisterPlayerChatEvent(trigger, Player(0), "", false);
    TriggerAddAction(trigger, () => DisplayTextToPlayer(Player(0), 0, 0, GetEventPlayerChatString()));
    const timer = CreateTimer();
    TimerStart(timer, 0, true, () => {});
  }, install: () => {} };
  const journey = { frames: 12, events: [{ frame: 0, player: 0, chat: "first" }, { frame: 4, player: 0, chat: "second" }, { frame: 4, player: 0, chat: "third" }] };
  const plain = runJourney(runtime.clients(map, [0]), journey);
  const captured: unknown[] = [];
  const observed = runJourney(runtime.clients(map, [0]), journey, {
    observationFrames: [12, 4, 0, 4, 2],
    observe: (clients, frame) => captured.push([frame, [...clients.client(0).messages]]),
  });
  expect(observed).toEqual(plain);
  expect(captured).toEqual([[0, ["first"]], [2, ["first"]], [4, ["first", "second", "third"]], [12, ["first", "second", "third"]]]);
});
