import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";
import { assertSoundCue } from "../src/headless/client";
import { runJourney } from "../src/headless/journey";

const runtime = installHeadless({ filePrefix: "observations", globalPrefixes: ["__observations"], frames: [{
  name: "Pips", type: "BACKDROP", width: 0.25, height: 0.125, texture: "panel.blp", children: [{
    key: "pip", type: "BACKDROP", width: 0.0625, height: 0.0625, texture: "pip.blp",
    points: [{ point: "TOPLEFT", x: 0.0625, y: -0.03125 }],
  }],
}] });
afterAll(runtime.restore);

test("unit snapshots capture fighters' transforms, animation clocks, hiding and removal", () => {
  let fighter: unit;
  const clients = runtime.clients({ start: () => {
    fighter = CreateUnit(Player(2), 0x48303030, 10, 20, 180);
    SetUnitX(fighter, 30);
    SetUnitY(fighter, 40);
    SetUnitFlyHeight(fighter, 300, 0);
    SetUnitScale(fighter, 2, 3, 4);
    BlzSetUnitFacingEx(fighter, 90);
    SetUnitVertexColor(fighter, 128, 64, 32, 140);
    SetUnitColor(fighter, PLAYER_COLOR_BLUE);
    SetUnitAnimationByIndex(fighter, 7);
    SetUnitTimeScale(fighter, 2);
  }, install: () => {} }, [0]);
  clients.start();
  clients.frames(30);
  const client = clients.client(0);
  const first = client.unitPoses()[0];
  expect(first).toMatchObject({ typeId: 0x48303030, owner: 2, x: 30, y: 40, z: 300, facing: 90, scale: [2, 3, 4],
    alpha: 140, color: [128, 64, 32], teamColor: 1, animation: 7, timeScale: 2, visible: true });
  expect(first?.animationElapsed).toBeCloseTo(1);
  client.run(() => {
    SetUnitAnimation(fighter, "Spell Two");
    SetUnitTimeScale(fighter, 0);
    SetUnitFacing(fighter, 270);
    ShowUnit(fighter, false);
  });
  clients.frames(10);
  expect(client.unitPoses()[0]).toMatchObject({ animation: "Spell Two", animationElapsed: 0, facing: 270, visible: false });
  client.run(() => {
    ShowUnit(fighter, true);
    SetUnitTimeScale(fighter, 1);
    SetUnitPosition(fighter, 50, 60);
    SetUnitScale(fighter, 1, 1, 1);
    SetUnitColor(fighter, ConvertPlayerColor(3));
  });
  clients.frames(15);
  expect(client.unitPoses()[0]).toMatchObject({ x: 50, y: 60, scale: [1, 1, 1], teamColor: 3, visible: true });
  expect(client.unitPoses()[0]?.animationElapsed).toBeCloseTo(0.25);
  expect(first?.scale).toEqual([2, 3, 4]);
  expect(client.log.filter(call => call.name === "CreateUnit").map(call => call.args)).toEqual([[2, 0x48303030, 10, 20, 180]]);
  client.run(() => RemoveUnit(fighter));
  expect(client.unitPoses()).toEqual([]);
});

test("effect snapshots preserve animation time, playback changes and complete transforms", () => {
  let effect: effect;
  const clients = runtime.clients({ start: () => {
    effect = AddSpecialEffect("fixture.mdx", 10, 20);
    BlzSetSpecialEffectPosition(effect, 10, 20, 30);
    BlzPlaySpecialEffectWithTimeScale(effect, ANIM_TYPE_ATTACK, 2);
    BlzSpecialEffectAddSubAnimation(effect, SUBANIM_TYPE_ALTERNATE_EX);
    BlzSetSpecialEffectOrientation(effect, 1, 2, 3);
    BlzSetSpecialEffectColor(effect, 128, 64, 32);
    BlzSetSpecialEffectColorByPlayer(effect, Player(3));
    BlzSetSpecialEffectMatrixScale(effect, 2, 3, 4);
  }, install: () => {} }, [0]);
  clients.start();
  clients.frames(30);
  const client = clients.client(0);
  const pose = client.effectPoses()[0];
  expect(pose).toMatchObject({ animation: "ANIM_TYPE_ATTACK", subAnimations: ["SUBANIM_TYPE_ALTERNATE_EX"],
    x: 10, y: 20, z: 30, yaw: 1, pitch: 2, roll: 3, color: [128, 64, 32], teamColor: 3, matrixScale: [2, 3, 4] });
  expect(pose?.animationElapsed).toBeCloseTo(1);
  client.run(() => {
    BlzSetSpecialEffectTime(effect, 5);
    BlzSetSpecialEffectTimeScale(effect, 0);
    BlzSetSpecialEffectYaw(effect, 4);
    BlzSetSpecialEffectPitch(effect, 5);
    BlzSetSpecialEffectRoll(effect, 6);
  });
  clients.frames(10);
  expect(client.effectPoses()[0]).toMatchObject({ animationElapsed: 5, yaw: 4, pitch: 5, roll: 6 });
  client.run(() => {
    BlzPlaySpecialEffect(effect, ANIM_TYPE_WALK);
    BlzSetSpecialEffectTimeScale(effect, 1);
    BlzSpecialEffectRemoveSubAnimation(effect, SUBANIM_TYPE_ALTERNATE_EX);
    BlzSetSpecialEffectMatrixScale(effect, 0, 1, 1);
  });
  clients.frames(15);
  expect(client.effectPoses()[0]).toMatchObject({ animation: "ANIM_TYPE_WALK", subAnimations: [], matrixScale: [0, 3, 4], flat: true });
  expect(client.effectPoses()[0]?.animationElapsed).toBeCloseTo(0.25);
  client.run(() => {
    BlzResetSpecialEffectMatrix(effect);
    BlzSetSpecialEffectAnimation(effect, "Spell Two");
    BlzSpecialEffectAddSubAnimation(effect, SUBANIM_TYPE_ALTERNATE_EX);
    BlzSpecialEffectClearSubAnimations(effect);
  });
  expect(client.effectPoses()[0]).toMatchObject({ animation: "Spell Two", animationElapsed: 0, subAnimations: [], matrixScale: [1, 1, 1], flat: false });
  expect(pose?.matrixScale).toEqual([2, 3, 4]);
});

test("camera and passive frame snapshots retain art, rectangles and ancestor visibility", () => {
  let root: framehandle;
  let pip: framehandle;
  const clients = runtime.clients({ start: () => {
    SetCameraPosition(120, 240);
    SetCameraField(CAMERA_FIELD_TARGET_DISTANCE, 600, 0);
    SetCameraField(ConvertCameraField(6), 300, 0);
    root = BlzCreateFrame("Pips", undefined, 0, 0);
    BlzFrameSetAbsPoint(root, FRAMEPOINT_TOPLEFT, 0.25, 0.5);
    pip = BlzGetFrameByName("PipsPip", 0);
    BlzFrameSetText(pip, "2");
    BlzFrameSetTexture(pip, "active.blp", 0, true);
    BlzFrameSetVertexColor(pip, 0xff804020);
    BlzFrameSetTextColor(pip, 0xff204080);
    BlzFrameSetAlpha(pip, 128);
  }, install: () => {} }, [0]);
  clients.start();
  const client = clients.client(0);
  expect(client.cameraPose()).toEqual({ x: 120, y: 240, fields: { CAMERA_FIELD_TARGET_DISTANCE: 600, CAMERA_FIELD_ZOFFSET: 300 } });
  const initial = client.frames.snapshot();
  expect(client.frames.snapshot({ visibleOnly: true })).toEqual(initial);
  expect(initial[0]).toMatchObject({ type: "BACKDROP", texture: "panel.blp", color: 0xffffffff, alpha: 255 });
  expect(initial[1]).toMatchObject({ rectangle: [0.3125, 0.46875, 0.375, 0.40625], text: "2", texture: "active.blp", color: 0xff804020, textColor: 0xff204080, alpha: 128, visible: true });
  client.run(() => BlzFrameSetVisible(root, false));
  expect(client.frames.snapshot().map(frame => frame.visible)).toEqual([false, false]);
  expect(client.frames.snapshot({ visibleOnly: true })).toEqual([]);
  expect(initial[1]?.visible).toBe(true);
  client.run(() => {
    BlzFrameSetVisible(root, true);
    BlzFrameClearAllPoints(pip);
    BlzFrameSetAllPoints(pip, root);
  });
  expect(client.frames.snapshot()[1]?.rectangle).toEqual(initial[0]?.rectangle);
  client.run(() => {
    BlzFrameClearAllPoints(pip);
    BlzFrameSetPoint(pip, FRAMEPOINT_TOPLEFT, root, FRAMEPOINT_TOPLEFT, 0, 0);
  });
  expect(client.frames.snapshot()[1]?.rectangle).toEqual([0.25, 0.5, 0.3125, 0.4375]);
  client.run(() => BlzFrameSetAlpha(root, 0));
  expect(client.frames.snapshot({ visibleOnly: true })).toEqual(client.frames.snapshot().filter(frame => frame.visible && frame.alpha > 0));
  expect(client.frames.snapshot({ visibleOnly: true })[0]?.rectangle).toEqual([0.25, 0.5, 0.3125, 0.4375]);
});

test("sound log records every creation and repeated start with the current parameters", () => {
  let sound: sound;
  let label: sound;
  const clients = runtime.clients({ start: () => {
    sound = CreateSound("hit.wav", false, true, false, 0, 0, "");
    label = CreateSoundFromLabel("Victory", false, false, false, 0, 0);
    CreateSoundFilenameWithLabel("ready.wav", false, false, false, 0, 0, "Ready");
    SetSoundVolume(sound, 64);
    SetSoundPitch(sound, 2);
    SetSoundPosition(sound, 1, 2, 3);
    StartSound(sound);
  }, install: () => {} }, [0]);
  clients.start();
  clients.frames(8);
  const client = clients.client(0);
  client.run(() => {
    SetSoundVolume(sound, 127);
    StartSound(sound);
    StartSoundEx(label, false);
  });
  expect(client.soundLog.map(({ event, frame, source, label }) => ({ event, frame, source, label }))).toEqual([
    { event: "create", frame: 0, source: "hit.wav", label: undefined },
    { event: "create", frame: 0, source: undefined, label: "Victory" },
    { event: "create", frame: 0, source: "ready.wav", label: "Ready" },
    { event: "start", frame: 0, source: "hit.wav", label: undefined },
    { event: "start", frame: 8, source: "hit.wav", label: undefined },
    { event: "start", frame: 8, source: undefined, label: "Victory" },
  ]);
  expect(client.soundLog[3]).toMatchObject({ volume: 64, pitch: 2, x: 1, y: 2, z: 3 });
  expect(client.soundLog[4]).toMatchObject({ volume: 127, pitch: 2, x: 1, y: 2, z: 3 });
  expect(() => assertSoundCue(client.soundLog, { source: "hit.wav", count: 2 })).not.toThrow();
  expect(() => assertSoundCue(client.soundLog, { label: "Victory", frame: 8 })).not.toThrow();
  expect(() => assertSoundCue(client.soundLog, { source: "ready.wav" })).toThrow("expected 1 starts, got 0");
  expect(client.log.filter(call => call.name.startsWith("CreateSound"))).toHaveLength(3);
  expect(client.log.filter(call => call.name.startsWith("StartSound"))).toHaveLength(3);
});

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

test("journey key down and release keep local polling held across frames", () => {
  const clients = runtime.clients({ start: () => {}, install: () => {} });
  const held: unknown[] = [];
  const result = runJourney(clients, { frames: 5, events: [
    { frame: 1, player: 0, key: 65, meta: 0, down: true },
    { frame: 3, player: 0, key: 65, meta: 0, down: false },
    { frame: 4, player: 0, key: 65, meta: 0 },
  ] }, { observationFrames: [0, 1, 2, 3, 4, 5], observe: (clients, frame) => {
    held.push([frame, clients.clients.map(client => {
      let pressed = false;
      client.run(() => { pressed = BlzIsKeyPressed(ConvertOsKeyType(65)); });
      return pressed;
    })]);
  } });
  expect(result.divergence).toBeUndefined();
  expect(held).toEqual([[0, [false, false]], [1, [true, false]], [2, [true, false]], [3, [false, false]], [4, [false, false]], [5, [false, false]]]);
});
