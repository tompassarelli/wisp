import { HeadlessClient, type Handle } from "../../src/headless/client";
import type { NativeDeclarations } from "../../src/headless/declarations";
import { Scenery, type DestructableState } from "../../src/headless/warcraft3Scenery";

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

export function sceneryFixture(this: void, declarations: NativeDeclarations, tested?: Set<string>): number {
  const scenery = new Scenery({
    hudScale: 2,
    cinematics: { movie: [2, 3] },
    pathing: [{ x: 10, y: 20, type: "PATHING_TYPE_WALKABILITY", blocked: true }, { x: 11, y: 20, type: "PATHING_TYPE_WALKABILITY", blocked: false }],
    doodads: [0, 1, 2].map(i => ({ id: i === 2 ? 8 : 7, x: i * 10, y: i + 1, z: i + 2, scaleX: 2, scaleY: 3, scaleZ: 4, usingModelAxes: true, yaw: 5, pitch: 6, roll: 7, variation: 8 })),
  });
  let next = 1000;
  const client = new HeadlessClient({ slot: 0, filePrefix: "scenery", humans: [0], declarations, localNatives: {}, network: [], screenWidth: 1600, natives: () => scenery.behaviors({ handle: kind => ({ kind, id: ++next }) }) });
  const called = new Set<string>();
  const call = (name: string, ...args: unknown[]): unknown => {
    const native = client.natives[name];
    if (typeof native !== "function") throw new Error(`missing declaration ${name}`);
    called.add(name);
    tested?.add(name);
    return (native as (this: void, ...args: unknown[]) => unknown)(...args);
  };
  call("SetTerrainFogExV", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11);
  equal(scenery.fog.heightStart, 5, "extended fog height");
  equal(scenery.fog.linearEnd, 8, "extended fog linear end");
  const fogFields: Readonly<Record<string, string>> = { Style: "style", ZStart: "zStart", ZEnd: "zEnd", Density: "density", HeightStart: "heightStart", HeightEnd: "heightEnd", LinearStart: "linearStart", LinearEnd: "linearEnd", MaxLinearDensity: "maxLinearDensity", DrawOverSky: "drawOverSky" };
  for (const suffix of Object.keys(fogFields)) {
    const value = suffix === "DrawOverSky" ? true : 19;
    call(`BlzSetTerrainFog${suffix}`, value);
    equal(scenery.fog[fogFields[suffix] ?? ""], value, `fog ${suffix}`);
  }
  call("BlzSetTerrainFogColor", 12, 13, 14);
  equal((scenery.fog.color as number[])[2], 14, "fog blue");
  call("SetSkyModel", "Environment\\Sky\\Test\\Test.mdl");
  equal(scenery.sky, "Environment\\Sky\\Test\\Test.mdl", "sky model");
  call("BlzShowTerrain", false);
  equal(scenery.terrainShown, false, "terrain hidden");
  call("BlzSetMinShadowCastingPointLightCount", 6);
  equal(call("BlzGetMinShadowCastingPointLightCount"), 6, "point light shadow count");
  call("SetCameraFieldControlledByInput", "camera-field", true);
  equal(call("GetCameraFieldControlledByInput", "camera-field"), true, "camera input control");
  call("SetCameraFieldControlledByInput", "camera-field", false);
  equal(call("GetCameraFieldControlledByInput", "camera-field"), false, "camera input release");
  call("BlzCameraSetCameraType", 3);
  equal(call("BlzCameraGetCameraType"), 3, "camera type");
  const setup = { kind: "camerasetup", id: 998 };
  const other = { kind: "camerasetup", id: 999 };
  call("BlzCameraSetupSetCameraType", setup, 4);
  equal(call("BlzCameraSetupGetCameraType", setup), 4, "camera setup type");
  equal(call("BlzCameraSetupGetCameraType", other), 0, "camera setup independence");
  const rect = call("Rect", -1, 0, 11, 3) as Handle;
  call("AddCameraBlocker", rect);
  equal(scenery.cameraBlockers.get(rect), true, "added blocker");
  call("EnableCameraBlocker", rect, false);
  equal(scenery.cameraBlockers.get(rect), false, "disabled blocker");
  call("BlzSetCameraAllowsHotkeyTargetLock", false);
  equal(call("BlzGetCameraAllowsHotkeyTargetLock"), false, "camera hotkey lock");
  equal(call("BlzGetHUDScale"), 2, "HUD fixture");
  equal(call("BlzPreloadModelCinematicGame", "movie"), true, "cinematic preload");
  equal(call("BlzGetModelCinematicGameShotCount"), 2, "preloaded shot count");
  call("BlzPlayModelCinematicGameAtPosition", "movie", 11, 12, 13, 14);
  equal(scenery.cinematic?.x, 11, "cinematic position");
  equal(scenery.cinematic?.rotation, 14, "cinematic rotation");
  equal(call("BlzGetModelCinematicGameCurrentShot"), 0, "first shot");
  equal(call("BlzGetModelCinematicGameRemainingTime"), 5, "cinematic length");
  scenery.tick(2);
  equal(call("BlzGetModelCinematicGameCurrentShot"), 1, "second shot");
  equal(call("BlzGetModelCinematicGameRemainingTime"), 3, "remaining cinematic time");
  scenery.tick(5);
  equal(call("BlzGetModelCinematicGameRemainingTime"), 0, "cinematic completion");
  call("BlzSetCinematicEnabledDE", false);
  equal(scenery.cinematicEnabledDE, false, "DE cinematic toggle");
  call("BlzPauseThematicMusicOnFocusLost", true);
  equal(scenery.thematicMusicPauseOnFocusLost, true, "thematic focus pause");
  call("BlzSetThematicMusicAbsoluteVolume", 73);
  equal(scenery.thematicMusicAbsoluteVolume, 73, "thematic volume");
  call("SetHDWaterParams", 1, 2, 3, true, 4, 5, 6, 7, 8, 9, 10);
  equal(scenery.water.waveStrength, 10, "water aggregate");
  call("SetHDWaterParamsEx", 11, 12, 13, false, 14, 15, 16, 17, 18, 19, 20, 21);
  equal(scenery.water.override, false, "water override");
  equal(scenery.water.envMapStrength, 21, "water environment map");
  call("BlzSetHDWaterColor", 22, 23, 24);
  equal((scenery.water.color as number[])[1], 23, "water green");
  for (const suffix of ["ColorOverride", "VertexDisplacement", "MinOpacity", "MaxOpacity", "Reflectivity", "Emissivity", "EdgeSoftness", "WaveStrength", "EnvMapStrength"]) {
    const value = suffix === "ColorOverride" ? true : 31;
    call(`BlzSetHDWater${suffix}`, value);
    equal(scenery.water[suffix === "ColorOverride" ? "override" : suffix.charAt(0).toLowerCase() + suffix.slice(1)], value, `water ${suffix}`);
  }
  equal(call("BlzIsTerrainPathableEx", 10, 20, "PATHING_TYPE_WALKABILITY"), true, "blocked terrain");
  equal(call("BlzIsTerrainPathableEx", 11, 20, "PATHING_TYPE_WALKABILITY"), false, "unblocked terrain");
  equal(call("BlzGetNumDoodads"), 3, "doodad count");
  const getters: Readonly<Record<string, unknown>> = { X: 0, Y: 1, Z: 2, ScaleX: 2, ScaleY: 3, ScaleZ: 4, IsUsingModelAxes: true, Yaw: 5, Pitch: 6, Roll: 7, Variation: 8, Id: 7 };
  for (const suffix of Object.keys(getters)) equal(call(`BlzGetDoodad${suffix}`, 0), getters[suffix], `doodad ${suffix}`);
  call("BlzSetSingleDoodadAnimation", 2, "stand", true);
  equal(scenery.doodads[2]?.animation, "stand", "single doodad animation");
  equal(scenery.doodads[2]?.animationRandom, true, "doodad animation random");
  call("SetDoodadAnimation", 0, 0, 12, 7, true, "death", false);
  equal(scenery.doodads[0]?.animation, "death", "nearest doodad animation");
  equal(scenery.doodads[1]?.animation, undefined, "nearest animation excludes other doodad");
  call("SetDoodadAnimationRect", rect, 7, "birth", true);
  equal(scenery.doodads[1]?.animation, "birth", "rectangle doodad animation");
  call("BlzSetSingleDoodadColor", 2, 5);
  equal(scenery.doodads[2]?.color, 5, "single doodad color");
  call("SetDoodadColor", 0, 0, 12, 7, true, 6);
  equal(scenery.doodads[0]?.color, 6, "nearest doodad color");
  equal(scenery.doodads[1]?.color, undefined, "nearest excludes other doodad");
  call("SetDoodadColorRect", rect, 7, 8);
  equal(scenery.doodads[1]?.color, 8, "rectangle doodad color");
  equal(scenery.doodads[2]?.color, 5, "rectangle excludes other type");
  const creators = declarations.functions.filter(([name]) => name.startsWith("BlzCreate") && name.includes("Destructable") && (name.includes("PitchRoll") || name.includes("Color")));
  equal(creators.length, 24, "destructable variant count");
  let last: Handle | undefined;
  for (const [name] of creators) {
    const z = name.includes("DestructableZ");
    const skin = name.includes("WithSkin");
    const orientation = name.includes("PitchRoll");
    const color = name.includes("Color");
    const args: unknown[] = [101, 102, 103];
    if (z) args.push(104);
    args.push(105);
    if (orientation) args.push(106, 107);
    args.push(108, 109);
    if (skin) args.push(110);
    if (color) args.push(111);
    const handle = call(name, ...args) as Handle;
    const d = scenery.destructables.get(handle) as DestructableState;
    equal(d.typeId, 101, `${name} id`); equal(d.x, 102, `${name} x`); equal(d.y, 103, `${name} y`);
    equal(d.z, z ? 104 : 0, `${name} z`); equal(d.facing, 105, `${name} facing`);
    equal(d.roll, orientation ? 106 : 0, `${name} roll`); equal(d.pitch, orientation ? 107 : 0, `${name} pitch`);
    equal(d.scale, 108, `${name} scale`); equal(d.variation, 109, `${name} variation`);
    equal(d.skinId, skin ? 110 : 101, `${name} skin`); equal(d.color, color ? 111 : undefined, `${name} color`);
    equal(d.dead, name.includes("Dead"), `${name} alive/dead`);
    last = handle;
  }
  if (last === undefined) throw new Error("no destructable created");
  call("SetDestructableColor", last, 13);
  call("SetDestructableVertexColor", last, 10, 20, 30, 40);
  equal(scenery.destructables.get(last)?.color, 13, "destructable team color");
  equal(scenery.destructables.get(last)?.vertexColor?.[3], 40, "destructable alpha");
  equal(scenery.destructables.size, 24, "distinct destructable handles");
  equal(client.missingNatives.length, 0, "modeled native coverage");
  for (const name of Object.keys(scenery.behaviors({ handle: kind => ({ kind, id: ++next }) }))) {
    equal(called.has(name), true, `${name} fixture called`);
  }
  for (const [name, args] of [["BlzPreloadModelCinematicGame", ["missing"]], ["BlzIsTerrainPathableEx", [12, 20, "PATHING_TYPE_WALKABILITY"]]] as const) {
    let rejected = false;
    try { call(name, ...args); } catch { rejected = true; }
    equal(rejected, true, `${name} requires map facts`);
  }
  return called.size;
}
