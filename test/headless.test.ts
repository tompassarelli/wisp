// What the headless runtime reports: a call one client makes alone, an error
// report, a reload no client runs, and what a player would see wrong. The
// sample's test (examples/sample/test/headless.test.ts) plays a passing
// journey in Bun and 32-bit Lua.
import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { Cause, Effect, Exit } from "effect";
import { makeHeadless } from "../scripts/wisp/commands/headless";
import { installHeadless, playHeadless } from "../scripts/wisp/headless";
import type { SceneExpectations } from "../scripts/wisp/scene";
import { parseNativeDeclarations } from "../src/headless/declarations";
import { installDispatch, on, trampoline } from "../src/platform/dispatch";
import { startSceneReport } from "../src/platform/scene";
import { configureRuntime } from "../src/runtime/config";
import { MEASURED_BATTLE_NET, syncDelivery } from "../src/headless/syncChannel";

const FIXTURE = { filePrefix: "fixture", globalPrefixes: ["__fixture"], localNatives: { BlzFrameSetText: "shows text on this client" } };
const runtime = installHeadless(FIXTURE);
afterAll(runtime.restore);

const configure = () => configureRuntime({ filePrefix: "fixture", readyPrefix: "FX_HRR", globalPrefix: "__fixture" });

/** A map whose every frame handler is `frame`, run by a periodic timer. */
const everyFrame = (frame: () => void) => ({
  start: () => {
    configure();
    installDispatch();
    on("fixture.frame", frame);
    TimerStart(CreateTimer(), 0.0, true, trampoline("fixture.frame"));
  },
  install: () => {},
});

test("a call one client makes alone is the desync, shown with the calls before it; local-only natives may differ", () => {
  const clients = runtime.clients(everyFrame(() => {
    const slot = GetPlayerId(GetLocalPlayer());
    BlzFrameSetText(BlzGetFrameByName("Score", 0), `${slot}`);
    // Match state lives in a global: module locals are shared by every client.
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

test("each client keeps its own globals and files", () => {
  const clients = runtime.clients(everyFrame(() => {
    globalThis.__fixtureFrames = (globalThis.__fixtureFrames ?? 0) + 1 + GetPlayerId(GetLocalPlayer());
    PreloadGenClear();
    Preload(`${globalThis.__fixtureFrames}`);
    PreloadGenEnd("fixture-frames.txt");
  }));
  clients.start();
  clients.frames(3);
  expect(clients.clients.map((client) => client.files.get("fixture-frames.txt"))).toEqual([["3"], ["6"]]);
  expect(globalThis.__fixtureFrames).toBeUndefined();
});

test("a declared native's parameter count includes a callback parameter and not what its type holds", () => {
  const { functions } = parseNativeDeclarations([
    "declare function GetLocalPlayer(): player;",
    "declare function ForGroup(whichGroup: group, callback: (this: void) => void): void;",
    "declare function CreateUnit(id: player, unitid: number, x: number, y: number, face: number): unit;",
  ].join("\n"));
  expect(functions).toEqual([["GetLocalPlayer", "player", 0], ["ForGroup", "void", 2], ["CreateUnit", "unit", 5]]);
});

const SCENE: SceneExpectations = {
  kinds: [{ name: "stage deck", models: ["Deck.mdx"] }, { name: "spark", models: ["Spark.mdx"], lifetime: 6 }],
  stage: { kind: "stage deck", pieces: 1 },
  framesPerSecond: 60,
};

test("the report lists an error report, a reload no client runs and what a player would see wrong", () => {
  const clients = runtime.clients({
    start: () => {
      configure();
      startSceneReport({ frame: () => globalThis.__fixtureFrame ?? 0, parked: (_x, _y, z) => z < 0 });
      installDispatch();
      const deck = AddSpecialEffect("Deck.mdx", 0, 0);
      BlzSetSpecialEffectAlpha(deck, 0);
      AddSpecialEffect("Spark.mdx", 0, 0);
      on("fixture.frame", () => {
        globalThis.__fixtureFrame = (globalThis.__fixtureFrame ?? 0) + 1;
        if (globalThis.__fixtureFrame === 20) throw new Error("boom");
      });
      TimerStart(CreateTimer(), 0.0, true, trampoline("fixture.frame"));
    },
    install: () => {},
  });
  const { lines, problems } = playHeadless(clients, { frames: 60, events: [{ frame: 10, reload: true }] }, "fixture", SCENE);
  for (const client of clients.clients) {
    expect(client.effectPoses().map(({ model, alpha, z }) => ({ model, alpha, z }))).toEqual([
      { model: "Deck.mdx", alpha: 0, z: 0 },
      { model: "Spark.mdx", alpha: 255, z: 0 },
    ]);
  }
  expect(lines).toContain("no desync in 60 frames");
  expect(lines).toContain("p0: hot reload 1 not running: no answer yet");
  expect(lines).toContain("p1: error in fixture.frame: Error: boom");
  expect(lines).toContain("p0 error report:");
  expect(lines).toContain("  error 1 in fixture.frame");
  expect(lines.some((line) => line.includes("headless.test.ts"))).toBe(true);
  expect(lines).toContain("p0 would see no stage under the fighters: 0 of the 1 stage deck pieces a match needs are drawn (models Deck.mdx)");
  expect(lines).toContain("p1 would see a spark stayed in view for 0.50 s; it should be gone within 0.10 s (model Spark.mdx: 30 frames without a break, lifetime 6; now 1 of 1 in view, 1 drawn)");
  // Two unapplied reloads, two error reports, two scene problems per client.
  expect(problems).toBe(8);
});

test("a map that turns error text off shows no report, while its error file and the client's error list keep it", () => {
  const failing = (errorsOnScreen?: boolean) => runtime.clients({
    start: () => {
      configureRuntime({ filePrefix: "fixture", readyPrefix: "FX_HRR", globalPrefix: "__fixture", ...(errorsOnScreen === undefined ? {} : { errorsOnScreen }) });
      installDispatch();
      on("fixture.frame", () => {
        throw new Error("boom");
      });
      TimerStart(CreateTimer(), 0.0, true, trampoline("fixture.frame"));
    },
    install: () => {},
  });
  const play = (errorsOnScreen?: boolean) => {
    const clients = failing(errorsOnScreen);
    clients.start();
    clients.frames(10);
    return clients.clients;
  };
  // Unconfigured, as before: shown, and the handler fails every frame but is reported once.
  for (const client of [...play(), ...play(true)]) {
    expect(client.messages).toEqual(["error in fixture.frame: Error: boom"]);
    expect(client.errors).toEqual(["error in fixture.frame: Error: boom"]);
    expect(client.files.get(`fixture-error-p${client.slot}.txt`)?.slice(0, 2)).toEqual(["error 1 in fixture.frame", "Error: boom"]);
  }
  for (const client of play(false)) {
    expect(client.messages).toEqual([]);
    expect(client.errors).toEqual(["error in fixture.frame: Error: boom"]);
    expect(client.files.get(`fixture-error-p${client.slot}.txt`)?.slice(0, 2)).toEqual(["error 1 in fixture.frame", "Error: boom"]);
  }
});

test("wisp headless fails with the problems it printed, and names its journeys", async () => {
  const command = makeHeadless(async () => ({
    map: FIXTURE,
    entry: join(import.meta.dir, "headless/entry.ts"),
    journeys: { seconds: { frames: 180, events: [] } },
  }));
  const failed = await Effect.runPromiseExit(command([]));
  expect(Exit.isFailure(failed) ? Cause.squash(failed.cause) : undefined).toMatchObject({ message: "seconds: 1 problem" });
  const usage = await Effect.runPromiseExit(command(["other"]));
  expect(Exit.isFailure(usage) ? Cause.squash(usage.cause) : undefined).toMatchObject({ _tag: "UsageFailure", message: "journeys: seconds" });
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
      TimerStart(CreateTimer(), 0.0, true, trampoline("fixture.frame"));
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
  // At once: after the sending frame's callbacks, before the next frame's.
  expect(received()).toEqual([5, 5]);
  // Measured latency: some frames later, on the same frame in both clients.
  const later = received(syncDelivery(MEASURED_BATTLE_NET, 1));
  expect(later[0]).toBe(later[1] ?? -1);
  expect(later[0] ?? 0).toBeGreaterThanOrEqual(5 + 4);
});
