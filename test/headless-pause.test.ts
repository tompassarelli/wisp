import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";
import { RealtimeClients, type DrawTiming } from "../scripts/wisp/headlessInput";
import { captureScene } from "../scripts/wisp/headlessRender";

declare const os: { clock(): number };

const runtime = installHeadless({ filePrefix: "pause86", globalPrefixes: [] });
afterAll(runtime.restore);

test("[repro #86] the presentation clock includes a three-second pause while frozen animation and callback clocks hold", () => {
  let fighter: unit;
  let effect: effect;
  const clients = runtime.clients({ start: () => {
    fighter = CreateUnit(Player(0), 0x48303030, 10, 20, 0);
    effect = AddSpecialEffect("original-fixture.mdx", 10, 20);
  }, install: () => {} }, [0]);
  let now = 0;
  const draws: DrawTiming[] = [];
  const realtime = new RealtimeClients(clients, new Map(), () => now, undefined, timing => draws.push(timing));
  realtime.start();
  const client = clients.client(0);
  now = 50;
  realtime.advance();
  client.run(() => {
    SetUnitTimeScale(fighter, 0);
    BlzSetSpecialEffectTimeScale(effect, 0);
  });
  const held = captureScene(client);
  realtime.hold(0);
  now = 3050;
  realtime.advance();
  client.run(() => expect(os.clock()).toBe(3.05));
  expect(client.frame).toBe(3);
  expect(captureScene(client)).toEqual(held);
  realtime.release(0);
  now = 3067;
  realtime.advance();
  expect(draws).toEqual([
    { draw: 1, wallTimeMs: 50, callbackFrame: 3, callbacks: 3 },
    { draw: 2, wallTimeMs: 3067, callbackFrame: 4, callbacks: 1 },
  ]);
  expect(client.unitPoses()).toEqual(held.units);
  expect(client.effectPoses()).toEqual(held.effects);
});

test("[spec #206] several resume callbacks before one draw retain the paused fighter pose until the next real draw", () => {
  let fighter: unit;
  let effect: effect;
  let resumed = false;
  let until = 0;
  let advanced = 0;
  const clients = runtime.clients({ start: () => {
    fighter = CreateUnit(Player(0), 0x48303030, 10, 20, 0);
    effect = AddSpecialEffect("original-fixture.mdx", 10, 20);
    SetUnitTimeScale(fighter, 0);
    BlzSetSpecialEffectTimeScale(effect, 0);
    TimerStart(CreateTimer(), 1 / 60, true, () => {
      if (!resumed) return;
      advanced++;
      if (os.clock() < until) return;
      SetUnitX(fighter, 10 + advanced);
      BlzSetSpecialEffectX(effect, 10 + advanced);
      SetUnitTimeScale(fighter, 1);
      BlzSetSpecialEffectTimeScale(effect, 1);
    });
  }, install: () => {} }, [0]);
  let now = 0;
  const pictures: { timing: DrawTiming; scene: ReturnType<typeof captureScene> }[] = [];
  const realtime = new RealtimeClients(clients, new Map(), () => now, undefined,
    timing => pictures.push({ timing, scene: captureScene(clients.client(0)) }));
  realtime.start();
  now = 3000;
  realtime.advance();
  const paused = captureScene(clients.client(0));
  resumed = true;
  clients.client(0).run(() => { until = os.clock() + 1 / 30; });
  now = 3017;
  realtime.advance();
  const first = pictures.at(-1);
  expect(first?.scene.units).toEqual(paused.units);
  expect(first?.scene.effects).toEqual(paused.effects);
  now = 3100;
  realtime.advance();
  const next = pictures.at(-1);
  expect(next?.timing.callbacks).toBe(5);
  expect(pictures).toHaveLength(3);
  expect(next?.scene.units[0]?.x).toBeGreaterThan(10);
  expect(next?.scene.effects[0]?.x).toBe(next?.scene.units[0]?.x);
  expect(clients.client(0).errors).toEqual([]);
});
