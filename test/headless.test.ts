import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../host/headless/headless";
import { installDispatch, on, trampoline } from "../src/map/dispatch";
import { configureRuntime } from "../src/runtime/config";
import { MEASURED_BATTLE_NET, MEASURED_RELAY, MEASURED_TURN_BURSTS, RELAY_MARK_PREFIX, RELAY_PROTOCOL_VERSION, relayCallbacks, relayDelivery, syncDelivery, turnBursts } from "../src/headless/syncChannel";

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

test("[property seed 66] every client receives each sync message on the frame its delivery gives, before that frame's callbacks, in arrival then send order; without a delivery, on the frame it was sent", () => {
  let seed = 66;
  const next = (below: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 16) % below;
  };
  for (const channel of [1, 2, 3]) {
    const sends = Array.from({ length: 60 }, (_, index) => [0, 1].filter(() => next(4) === 0).map((sender) => ({ sender, frame: index + 1 }))).flat();
    const map = () => ({
      start: () => {
        configure();
        installDispatch();
        globalThis.__fixtureReceived = [];
        on("fixture.frame", () => {
          globalThis.__fixtureFrame = (globalThis.__fixtureFrame ?? 0) + 1;
          const slot = GetPlayerId(GetLocalPlayer());
          for (const { sender, frame } of sends) if (sender === slot && frame === globalThis.__fixtureFrame) BlzSendSyncData("FX_SYNC", `${sender}:${frame}`);
        });
        on("fixture.sync", () => {
          globalThis.__fixtureReceived?.push(`${BlzGetTriggerSyncData()}@${globalThis.__fixtureFrame ?? 0}`);
        });
        const trigger = CreateTrigger();
        for (const sender of [0, 1]) BlzTriggerRegisterPlayerSyncEvent(trigger, Player(sender), "FX_SYNC", false);
        TriggerAddAction(trigger, trampoline("fixture.sync"));
        TimerStart(CreateTimer(), 1 / 60, true, trampoline("fixture.frame"));
      },
      install: () => {},
    });
    const received = (delivery?: ReturnType<typeof syncDelivery>) => {
      const clients = runtime.clients(map(), [0, 1], delivery === undefined ? {} : { delivery });
      clients.start();
      clients.frames(90);
      expect(clients.firstDivergence()).toBeUndefined();
      return clients.clients.map((client) => {
        let seen: readonly string[] = [];
        client.run(() => {
          seen = globalThis.__fixtureReceived ?? [];
        });
        return seen;
      });
    };
    const model = syncDelivery(MEASURED_BATTLE_NET, channel);
    const arrivals = sends.map((send) => ({ ...send, arrival: model.arrivalFrame(send.sender, send.frame, { sender: send.sender, prefix: "FX_SYNC", data: `${send.sender}:${send.frame}` }) }));
    // A message arriving at frame n is delivered before frame n's callbacks, which then count frame n.
    const expected = arrivals.toSorted((a, b) => a.arrival - b.arrival).map(({ sender, frame, arrival }) => `${sender}:${frame}@${arrival - 1}`);
    expect(arrivals.every(({ arrival }) => arrival < 90)).toBe(true);
    expect(received(syncDelivery(MEASURED_BATTLE_NET, channel))).toEqual([expected, expected]);
    const sent = sends.map(({ sender, frame }) => `${sender}:${frame}@${frame}`);
    expect(received()).toEqual([sent, sent]);
  }
});

test("[invariant] with turn-burst callbacks each callback reads its turn's wall time from os.clock and a sync message lands only on a turn's first callback", () => {
  const timing = turnBursts(MEASURED_TURN_BURSTS, 5);
  const clocks: number[][] = [[], []];
  const landed: number[][] = [[], []];
  const clients = runtime.clients({
    start: () => {
      configure();
      installDispatch();
      globalThis.__fixtureFrame = 0;
      on("fixture.frame", () => {
        globalThis.__fixtureFrame = (globalThis.__fixtureFrame ?? 0) + 1;
        const slot = GetPlayerId(GetLocalPlayer());
        clocks[slot]?.push(os.clock());
        BlzSendSyncData("FX_SYNC", `${globalThis.__fixtureFrame}`);
      });
      on("fixture.sync", () => {
        landed[GetPlayerId(GetLocalPlayer())]?.push((globalThis.__fixtureFrame ?? 0) + 1);
      });
      const trigger = CreateTrigger();
      for (const sender of [0, 1]) BlzTriggerRegisterPlayerSyncEvent(trigger, Player(sender), "FX_SYNC", false);
      TriggerAddAction(trigger, trampoline("fixture.sync"));
      TimerStart(CreateTimer(), 1 / 60, true, trampoline("fixture.frame"));
    },
    install: () => {},
  }, [0, 1], { delivery: syncDelivery(MEASURED_BATTLE_NET, 5), callbacks: timing });
  clients.start();
  clients.frames(600);
  expect(clients.firstDivergence()).toBeUndefined();
  const expected = Array.from({ length: 600 }, (_, index) => timing.wallMs(index + 1) / 1000);
  expect(clocks).toEqual([expected, expected]);
  expect(landed[0]).toEqual(landed[1] ?? []);
  expect((landed[0] ?? []).length).toBeGreaterThan(900);
  for (const frame of landed[0] ?? []) expect(timing.wallMs(frame)).toBeGreaterThan(timing.wallMs(frame - 1));
});

test("[spec wisp#52] relay delivery leads the first turn with one relay mark from the lowest slot; Battle.net delivery and turn bursts never send one", () => {
  const marks = (players: readonly number[], options: Parameters<typeof runtime.clients>[2]) => {
    const seen: string[][] = players.map(() => []);
    const clients = runtime.clients({
      start: () => {
        configure();
        installDispatch();
        globalThis.__fixtureFrame = 0;
        on("fixture.frame", () => {
          globalThis.__fixtureFrame = (globalThis.__fixtureFrame ?? 0) + 1;
        });
        on("fixture.mark", () => {
          seen[players.indexOf(GetPlayerId(GetLocalPlayer()))]?.push(`${GetPlayerId(GetTriggerPlayer())}:${BlzGetTriggerSyncData()}@${globalThis.__fixtureFrame ?? 0}`);
        });
        const trigger = CreateTrigger();
        for (const sender of players) BlzTriggerRegisterPlayerSyncEvent(trigger, Player(sender), RELAY_MARK_PREFIX, false);
        TriggerAddAction(trigger, trampoline("fixture.mark"));
        TimerStart(CreateTimer(), 1 / 60, true, trampoline("fixture.frame"));
        if (GetPlayerId(GetLocalPlayer()) === 2) BlzSendSyncData(RELAY_MARK_PREFIX, "map");
      },
      install: () => {},
    }, players, options);
    clients.start();
    clients.frames(120);
    expect(clients.firstDivergence()).toBeUndefined();
    return seen;
  };
  const sent = (seen: readonly string[][]) => seen.map((messages) => messages.map((message) => message.split("@")[0]));
  const mark = `1:${RELAY_PROTOCOL_VERSION}@0`;
  for (const options of [{ delivery: relayDelivery(MEASURED_RELAY, 5), callbacks: relayCallbacks() }, { delivery: relayDelivery(MEASURED_RELAY, 5) }]) {
    const seen = marks([2, 1], options);
    expect(seen.map((messages) => messages[0])).toEqual([mark, mark]);
    expect(sent(seen)).toEqual([[`1:${RELAY_PROTOCOL_VERSION}`, "2:map"], [`1:${RELAY_PROTOCOL_VERSION}`, "2:map"]]);
  }
  for (const options of [{ delivery: syncDelivery() }, { delivery: syncDelivery(), callbacks: turnBursts() }, { callbacks: turnBursts() }]) {
    expect(sent(marks([2, 1], options))).toEqual([["2:map"], ["2:map"]]);
  }
});
