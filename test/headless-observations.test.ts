import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";
import { assertSoundCue } from "../src/headless/client";
import { runJourney } from "../src/headless/journey";
import { startSceneReport } from "../src/platform/scene";
import { sceneMatchFrame } from "../src/runtime/scene";
import { runtimeConfiguration } from "../src/runtime/config";

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

test("unit snapshots capture fighters' transforms, animation clocks, hiding and removal", () => {
  let fighter: unit;
  const clients = runtime.clients({ start: () => {
    fighter = CreateUnit(Player(2), 0x48303030, 10, 20, 180);
    SetUnitX(fighter, 30);
    SetUnitY(fighter, 40);
    UnitAddAbility(fighter, 0x416d7266);
    UnitRemoveAbility(fighter, 0x416d7266);
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
  // Facing reads 90 and 270 one ulp below their writes (wisp:docs/warsmash-notes.md).
  expect(first).toMatchObject({ typeId: 0x48303030, owner: 2, x: 30, y: 40, z: 300, facing: 89.99999237060547, scale: [2, 3, 4],
    alpha: 140, color: [128, 64, 32], teamColor: 1, animation: 7, timeScale: 2, visible: true });
  expect(first?.animationElapsed).toBeCloseTo(1);
  client.run(() => {
    SetUnitAnimation(fighter, "Spell Two");
    SetUnitTimeScale(fighter, 0);
    SetUnitFacing(fighter, 270);
    ShowUnit(fighter, false);
  });
  clients.frames(10);
  expect(client.unitPoses()[0]).toMatchObject({ animation: "Spell Two", animationElapsed: 0, facing: 269.9999694824219, visible: false });
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

test("released sound records disappear, while playing and looping sounds finish before release", () => {
  const clients = runtime.clients({ start: () => {}, install: () => {} }, [0]);
  clients.start();
  const client = clients.client(0);
  const sounds = Reflect.get(client, "sounds") as Map<unknown, unknown>;
  client.run(() => {
    for (let index = 0; index < 1000; index++) {
      const sound = CreateSound("released.wav", false, false, false, 0, 0, "");
      KillSoundWhenDone(sound);
    }
  });
  expect(sounds.size).toBe(0);
  expect(client.missingNatives.filter(({ native }) => native === "KillSoundWhenDone")).toEqual([]);
  let playing: sound;
  let loop: sound;
  client.run(() => {
    playing = CreateSound("playing.wav", false, false, false, 0, 0, "");
    SetSoundDuration(playing, 1000);
    SetSoundPitch(playing, 2);
    StartSound(playing);
    KillSoundWhenDone(playing);
    loop = CreateSound("loop.wav", true, false, false, 0, 0, "");
    SetSoundDuration(loop, 100);
    StartSound(loop);
    KillSoundWhenDone(loop);
  });

  const live = (handle: sound) => (sounds.get(handle) as { playing: boolean } | undefined)?.playing ?? false;
  clients.frames(29);
  client.run(() => expect(GetSoundIsPlaying(playing)).toBe(false));
  expect([live(playing), live(loop)]).toEqual([true, true]);
  clients.frames(2);
  expect([live(playing), live(loop)]).toEqual([false, true]);
  client.run(() => StopSound(loop, false, false));
  expect(sounds.size).toBe(0);
  const checksum = client.checksum();
  client.soundLog.length = 0;
  expect(client.checksum()).toBe(checksum);
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

test("[native capture: smashcraft:ts/src/platform/nativeCaptureMain.ts] match-frame observations wait for the frame the map's scene report names, not the client frame", () => {
  const clock = globalThis as Record<string, timer | undefined>;
  const map = { start: () => {
    startSceneReport({ frame: () => { const match = clock.__observationsMatch; return match === undefined ? 0 : Math.round(TimerGetElapsed(match) * 60); }, parked: () => false });
    const trigger = CreateTrigger();
    TriggerRegisterPlayerChatEvent(trigger, Player(0), "go", true);
    TriggerAddAction(trigger, () => { const match = CreateTimer(); TimerStart(match, 3600, false, () => {}); clock.__observationsMatch = match; });
  }, install: () => {} };
  const seen: number[][] = [];
  runJourney(runtime.clients(map, [0]), { frames: 100, events: [{ frame: 30, player: 0, chat: "go" }] }, {
    observationFrames: [50, 10],
    observationClock: (clients) => { let frame: number | undefined; clients.client(0).run(() => { frame = sceneMatchFrame([runtimeConfiguration().globalPrefix]); }); return frame; },
    observe: (clients, frame) => seen.push([frame, clients.frame]),
  });
  expect(seen).toEqual([[10, 40], [50, 80]]);
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

test("[spec #40] the cinematic filter shows from DisplayCineFilter(true) until false, moving from its start to its end colour over its duration", () => {
  const clients = runtime.clients({ start: () => {
    SetCineFilterTexture("ReplaceableTextures\\CameraMasks\\White_Mask.blp");
    SetCineFilterBlendMode(BLEND_MODE_MODULATE_2X);
    SetCineFilterTexMapFlags(TEXMAP_FLAG_NONE);
    SetCineFilterStartColor(185, 185, 185, 255);
    SetCineFilterEndColor(255, 255, 255, 255);
    SetCineFilterDuration(1);
  }, install: () => {} }, [0]);
  clients.start();
  const client = clients.client(0);
  expect(client.cineFilterPose()).toBeUndefined();
  client.run(() => DisplayCineFilter(true));
  expect(client.cineFilterPose()).toMatchObject({ texture: "ReplaceableTextures\\CameraMasks\\White_Mask.blp", blendMode: "BLEND_MODE_MODULATE_2X", color: [185, 185, 185, 255], uv: [0, 0, 1, 1] });
  clients.frames(30);
  expect(client.cineFilterPose()?.color[0]).toBeCloseTo(220, 0);
  clients.frames(60);
  expect(client.cineFilterPose()?.color).toEqual([255, 255, 255, 255]);
  client.run(() => DisplayCineFilter(false));
  expect(client.cineFilterPose()).toBeUndefined();
});

test("[spec #40] a text frame's snapshot carries its template font, justification and BlzFrameSetScale", () => {
  let damage: framehandle;
  let label: framehandle;
  const clients = runtime.clients({ start: () => {
    damage = BlzCreateFrame("Damage", undefined, 0, 0);
    label = BlzCreateFrameByType("TEXT", "Label", undefined, "", 0);
    BlzFrameSetFont(label, "Fonts\\FRIZQT__.TTF", 0.0072, 1);
    BlzFrameSetTextAlignment(label, TEXT_JUSTIFY_BOTTOM, TEXT_JUSTIFY_RIGHT);
    BlzFrameSetScale(label, 0.6);
  }, install: () => {} }, [0]);
  clients.start();
  const client = clients.client(0);
  const [shown, labelled] = client.frames.snapshot();

  expect(shown).toMatchObject({ text: "0.0%", font: { file: "MasterFont", height: 0.036, flags: 1 }, alignment: { vertical: "middle", horizontal: "left" }, scale: 1 });
  expect(labelled).toMatchObject({ font: { file: "Fonts\\FRIZQT__.TTF", height: 0.0072, flags: 1 }, alignment: { vertical: "bottom", horizontal: "right" }, scale: 0.6 });
  client.run(() => BlzFrameSetTextAlignment(damage, TEXT_JUSTIFY_MIDDLE, TEXT_JUSTIFY_RIGHT));
  expect(client.frames.snapshot()[0]?.alignment).toEqual({ vertical: "middle", horizontal: "right" });
  expect(client.frames.snapshot()[1]?.alignment).toEqual(labelled?.alignment);
});

test("[spec #40] a text tag shows where it was placed, drifts by its velocity, and one that isn't permanent fades out at its lifespan", () => {
  let tag: texttag;
  const clients = runtime.clients({ start: () => {
    tag = CreateTextTag();
    SetTextTagText(tag, "CHARGING", 0.019);
    SetTextTagColor(tag, 255, 210, 50, 255);
    SetTextTagPos(tag, 100, 200, 145);
  }, install: () => {} }, [0]);
  clients.start();
  const client = clients.client(0);
  expect(client.textTags.poses()).toMatchObject([{ text: "CHARGING", height: 0.019, x: 100, y: 200, z: 145, color: [255, 210, 50, 255] }]);
  client.run(() => SetTextTagVisibility(tag, false));
  expect(client.textTags.poses()).toEqual([]);
  client.run(() => {
    SetTextTagVisibility(tag, true);

    SetTextTagVelocity(tag, 0, 64 * 0.071 / 128);
    SetTextTagPermanent(tag, false);
    SetTextTagLifespan(tag, 2);
    SetTextTagFadepoint(tag, 1);
  });
  clients.frames(90);
  const [fading] = client.textTags.poses();
  expect(fading?.y).toBeCloseTo(296, 0);
  expect(fading?.color[3]).toBeCloseTo(128, -1);
  clients.frames(30);
  expect(client.textTags.poses()).toEqual([]);
});
