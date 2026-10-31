import { boundWorld } from "./world";

export function clearFileLines(): void {
  const world = boundWorld();
  world.log?.("PreloadGenClear", []);
  world.files.clear();
}

export function startFile(): void {
  boundWorld().log?.("PreloadGenStart", []);
}

export function addFileLine(text: string): void {
  const world = boundWorld();
  world.log?.("Preload", [text]);
  world.files.add(text);
}

export function endFile(path: string): void {
  const world = boundWorld();
  world.log?.("PreloadGenEnd", [path]);
  world.files.end(path);
}

export function preloadAsset(path: string): void {
  boundWorld().log?.("Preload", [path]);
}
