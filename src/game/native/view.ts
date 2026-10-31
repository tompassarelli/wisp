import type { CameraField, FilterBlendMode, FilterTexMapFlags } from "../view";
import { boundWorld } from "./world";

export function setCameraField(field: CameraField, value: number, duration: number): void {
  const world = boundWorld();
  world.log?.("SetCameraField", [field, value, duration]);
  world.view.setCameraField(field, value);
}

export function setCameraBounds(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void {
  const world = boundWorld();
  world.log?.("SetCameraBounds", [x1, y1, x2, y2, x3, y3, x4, y4]);
}

export function setCameraPosition(x: number, y: number): void {
  const world = boundWorld();
  world.log?.("SetCameraPosition", [x, y]);
  world.view.setCameraPosition(x, y);
}

export function panCameraTo(x: number, y: number, duration: number): void {
  const world = boundWorld();
  world.log?.("PanCameraToTimed", [x, y, duration]);
}

export function setCameraSmoothing(factor: number): void {
  const world = boundWorld();
  world.log?.("CameraSetSmoothingFactor", [factor]);
}

export function cameraField(field: CameraField): number {
  const world = boundWorld();
  world.log?.("GetCameraField", [field]);
  return world.view.cameraField(field);
}

export function cameraTargetX(): number {
  const world = boundWorld();
  world.log?.("GetCameraTargetPositionX", []);
  return world.view.targetX();
}

export function cameraTargetY(): number {
  const world = boundWorld();
  world.log?.("GetCameraTargetPositionY", []);
  return world.view.targetY();
}

export function cameraTargetZ(): number {
  const world = boundWorld();
  world.log?.("GetCameraTargetPositionZ", []);
  return 0;
}

export function cameraEyeX(): number {
  const world = boundWorld();
  world.log?.("GetCameraEyePositionX", []);
  return 0;
}

export function cameraEyeY(): number {
  const world = boundWorld();
  world.log?.("GetCameraEyePositionY", []);
  return 0;
}

export function cameraEyeZ(): number {
  const world = boundWorld();
  world.log?.("GetCameraEyePositionZ", []);
  return 0;
}

export function setTerrainFog(style: number, start: number, end: number, density: number, red: number, green: number, blue: number): void {
  const world = boundWorld();
  world.log?.("SetTerrainFogEx", [style, start, end, density, red, green, blue]);
  world.view.setFog(style, start, end, density, red, green, blue);
}

export function setTerrainFogHeight(style: number, start: number, end: number, density: number, heightStart: number, heightEnd: number, linearStart: number, linearEnd: number, red: number, green: number, blue: number): void {
  const world = boundWorld();
  world.log?.("SetTerrainFogExV", [style, start, end, density, heightStart, heightEnd, linearStart, linearEnd, red, green, blue]);
  world.view.setFogHeight(style, start, end, density, heightStart, heightEnd, linearStart, linearEnd, red, green, blue);
}

export function resetTerrainFog(): void {
  const world = boundWorld();
  world.log?.("ResetTerrainFog", []);
  world.view.resetFog();
}

export function setTerrainFogMaxDensity(density: number): void {
  const world = boundWorld();
  world.log?.("BlzSetTerrainFogMaxLinearDensity", [density]);
  world.view.fog.maxLinearDensity = density;
}

export function setTerrainFogOverSky(overSky: boolean): void {
  const world = boundWorld();
  world.log?.("BlzSetTerrainFogDrawOverSky", [overSky]);
  world.view.fog.drawOverSky = overSky;
}

export function enableFog(enabled: boolean): void {
  const world = boundWorld();
  world.log?.("FogEnable", [enabled]);
}

export function enableFogMask(enabled: boolean): void {
  const world = boundWorld();
  world.log?.("FogMaskEnable", [enabled]);
}

export function setSkyModel(model: string): void {
  const world = boundWorld();
  world.log?.("SetSkyModel", [model]);
  world.view.environment.sky = model;
}

export function showSky(visible: boolean): void {
  const world = boundWorld();
  world.log?.("BlzShowSkyBox", [visible]);
  world.view.environment.skyVisible = visible;
}

export function showTerrain(visible: boolean): void {
  const world = boundWorld();
  world.log?.("BlzShowTerrain", [visible]);
  world.view.environment.terrainVisible = visible;
}

export function setDayNightModels(terrain: string, units: string): void {
  const world = boundWorld();
  world.log?.("SetDayNightModels", [terrain, units]);
  world.view.environment.dayNight = { terrain, unit: units };
}

export function setTimeOfDay(hours: number): void {
  const world = boundWorld();
  world.log?.("SetTimeOfDay", [hours]);
  world.view.environment.timeOfDay = hours;
}

export function setTimeOfDayScale(scale: number): void {
  const world = boundWorld();
  world.log?.("SetTimeOfDayScale", [scale]);
}

export function setShadowLightCount(count: number): void {
  const world = boundWorld();
  world.log?.("BlzSetMinShadowCastingPointLightCount", [count]);
  world.view.minShadowCastingPointLightCount = count;
}

export function setFilterTexture(texture: string): void {
  const world = boundWorld();
  world.log?.("SetCineFilterTexture", [texture]);
  world.view.setFilterTexture(texture);
}

export function setFilterBlendMode(mode: FilterBlendMode): void {
  const world = boundWorld();
  world.log?.("SetCineFilterBlendMode", [mode]);
  world.view.setFilterBlendMode(mode);
}

export function setFilterTexMapFlags(flags: FilterTexMapFlags): void {
  const world = boundWorld();
  world.log?.("SetCineFilterTexMapFlags", [flags]);
  world.view.setFilterTexMapFlags(flags);
}

export function setFilterStartUV(minU: number, minV: number, maxU: number, maxV: number): void {
  const world = boundWorld();
  world.log?.("SetCineFilterStartUV", [minU, minV, maxU, maxV]);
  world.view.setFilterStartUV(minU, minV, maxU, maxV);
}

export function setFilterEndUV(minU: number, minV: number, maxU: number, maxV: number): void {
  const world = boundWorld();
  world.log?.("SetCineFilterEndUV", [minU, minV, maxU, maxV]);
  world.view.setFilterEndUV(minU, minV, maxU, maxV);
}

export function setFilterStartColor(red: number, green: number, blue: number, alpha: number): void {
  const world = boundWorld();
  world.log?.("SetCineFilterStartColor", [red, green, blue, alpha]);
  world.view.setFilterStartColor(red, green, blue, alpha);
}

export function setFilterEndColor(red: number, green: number, blue: number, alpha: number): void {
  const world = boundWorld();
  world.log?.("SetCineFilterEndColor", [red, green, blue, alpha]);
  world.view.setFilterEndColor(red, green, blue, alpha);
}

export function setFilterDuration(seconds: number): void {
  const world = boundWorld();
  world.log?.("SetCineFilterDuration", [seconds]);
  world.view.setFilterDuration(seconds);
}

export function showFilter(visible: boolean): void {
  const world = boundWorld();
  world.log?.("DisplayCineFilter", [visible]);
  world.view.showFilter(visible);
}

