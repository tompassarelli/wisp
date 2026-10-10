import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";
import { installDispatch, on, trampoline } from "../src/platform/dispatch";
import { configureRuntime } from "../src/runtime/config";
import { MEASURED_BATTLE_NET, syncDelivery } from "../src/headless/syncChannel";

const FIXTURE = { filePrefix: "fixture", globalPrefixes: ["__fixture"], localNatives: { BlzFrameSetText: "shows text on this client" } };
const runtime = installHeadless(FIXTURE);
afterAll(runtime.restore);

const configure = () => configureRuntime({ filePrefix: "fixture", readyPrefix: "FX_HRR", globalPrefix: "__fixture" });

const everyFrame = (frame: () => void) => ({
  start: () => {
    configure();
    installDispatch();
    on("fixture.frame", frame);
    TimerStart(CreateTimer(), 1 / 60, true, trampoline("fixture.frame"));
  },
  install: () => {},
});

test("a call one client makes alone is the desync, shown with the calls before it; local-only natives may differ", () => {
  const clients = runtime.clients(everyFrame(() => {
    const slot = GetPlayerId(GetLocalPlayer());
    BlzFrameSetText(BlzGetFrameByName("Score", 0), `${slot}`);

    globalThis.__fixtureFrame = (globalThis.__fixtureFrame ?? 0) + 1;
    SetUnitX(CreateUnit(Player(0), 0x68666f6f, 0.0, 0.0, 0.0), 10);
    if (globalThis.__fixtureFrame === 7 && slot === 1) CreateTimer();
  }));
  clients.start();
  clients.frames(5);
  expect(clients.firstDivergence()).toBeUndefined();
  clients.frames(5);
  const divergence = clients.firstDivergence() ?? "";
  expect(divergence).toStartWith("call ");
  expect(divergence).toContain("differs between slot 0 and slot 1");
  const [, slot0 = "", slot1 = ""] = divergence.split(/\n  slot \d:\n/);
  expect(slot0).toContain("SetUnitX(unit#");
  expect(slot1.split("\n").map((line) => line.trim())).toContain("CreateTimer()");
  expect(slot0).not.toContain("CreateTimer()");
});

test("with keepCalls, clients compare every frame and keep only their latest calls, with the same checksums and desync", () => {
  const map = everyFrame(() => {
    globalThis.__fixtureFrame = (globalThis.__fixtureFrame ?? 0) + 1;
    SetUnitX(CreateUnit(Player(0), 0x68666f6f, 0.0, 0.0, 0.0), globalThis.__fixtureFrame);
    if (globalThis.__fixtureFrame === 7 && GetPlayerId(GetLocalPlayer()) === 1) CreateTimer();
  });
  const whole = runtime.clients(map);
  const kept = runtime.clients(map, [0, 1], { keepCalls: 2 });
  for (const clients of [whole, kept]) {
    clients.start();
    clients.frames(5);
  }
  expect(kept.clients.map((client) => client.log.length)).toEqual([2, 2]);
  expect(kept.clients.map((client) => [client.callCount(), client.checksum()])).toEqual(whole.clients.map((client) => [client.log.length, client.checksum()]));
  for (const clients of [whole, kept]) clients.frames(5);
  const desync = kept.firstDivergence() ?? "";
  expect(desync.split(":")[0]).toBe(`after frame 7, ${(whole.firstDivergence() ?? "").split(":")[0]}`);
  expect(desync).toContain("CreateTimer()");
  expect(kept.clients.map((client) => client.log.length)).toEqual([2, 2]);
});

test("with a delivery, a sync message reaches every client on its arrival frame, before that frame's callbacks", () => {
  const map = () => ({
    start: () => {
      configure();
      installDispatch();
      on("fixture.frame", () => {
        globalThis.__fixtureFrame = (globalThis.__fixtureFrame ?? 0) + 1;
        if (globalThis.__fixtureFrame === 5 && GetPlayerId(GetLocalPlayer()) === 0) BlzSendSyncData("FX_SYNC", "ping");
      });
      on("fixture.sync", () => {
        globalThis.__fixtureReceived = globalThis.__fixtureFrame ?? 0;
      });
      const trigger = CreateTrigger();
      BlzTriggerRegisterPlayerSyncEvent(trigger, Player(0), "FX_SYNC", false);
      TriggerAddAction(trigger, trampoline("fixture.sync"));
      TimerStart(CreateTimer(), 1 / 60, true, trampoline("fixture.frame"));
    },
    install: () => {},
  });
  const received = (delivery?: ReturnType<typeof syncDelivery>) => {
    const clients = runtime.clients(map(), [0, 1], delivery === undefined ? {} : { delivery });
    clients.start();
    clients.frames(30);
    expect(clients.firstDivergence()).toBeUndefined();
    return clients.clients.map((client) => {
      let frame = -1;
      client.run(() => {
        frame = globalThis.__fixtureReceived ?? -1;
      });
      return frame;
    });
  };

  expect(received()).toEqual([5, 5]);

  const later = received(syncDelivery(MEASURED_BATTLE_NET, 1));
  expect(later[0]).toBe(later[1] ?? -1);
  expect(later[0] ?? 0).toBeGreaterThanOrEqual(5 + 4);
});
