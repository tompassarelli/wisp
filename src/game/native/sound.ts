import type { Sound, VolumeGroup } from "../sound";
import { asHandle, fromHandle } from "./types";
import { boundWorld } from "./world";

export function createSound(file: string, looping: boolean, positional: boolean, stopOutOfRange: boolean, fadeInRate: number, fadeOutRate: number, environment: string): Sound {
  const world = boundWorld();
  world.log?.("CreateSound", [file, looping, positional, stopOutOfRange, fadeInRate, fadeOutRate, environment]);
  return fromHandle<Sound>(world.sounds.create(file, undefined, looping));
}

export function soundFromLabel(label: string, looping: boolean, positional: boolean, stopOutOfRange: boolean, fadeInRate: number, fadeOutRate: number): Sound {
  const world = boundWorld();
  world.log?.("CreateSoundFromLabel", [label, looping, positional, stopOutOfRange, fadeInRate, fadeOutRate]);
  return fromHandle<Sound>(world.sounds.create(undefined, label, looping));
}

export function playSound(sound: Sound): void {
  const world = boundWorld();
  world.log?.("StartSound", [sound]);
  world.sounds.start(asHandle(sound));
}

export function stopSound(sound: Sound, release: boolean, fadeOut: boolean): void {
  const world = boundWorld();
  world.log?.("StopSound", [sound, release, fadeOut]);
  world.sounds.stop(asHandle(sound), release);
}

export function setSoundVolume(sound: Sound, volume: number): void {
  const world = boundWorld();
  world.log?.("SetSoundVolume", [sound, volume]);
  world.sounds.setVolume(asHandle(sound), volume);
}

export function setSoundPitch(sound: Sound, pitch: number): void {
  const world = boundWorld();
  world.log?.("SetSoundPitch", [sound, pitch]);
  world.sounds.setPitch(asHandle(sound), pitch);
}

export function setSoundPosition(sound: Sound, x: number, y: number, z: number): void {
  const world = boundWorld();
  world.log?.("SetSoundPosition", [sound, x, y, z]);
  world.sounds.setPosition(asHandle(sound), x, y, z);
}

// The native window mixes with distance rules of its own, so the attenuation range only reaches the call log.
export function setSoundDistances(sound: Sound, nearest: number, farthest: number): void {
  boundWorld().log?.("SetSoundDistances", [sound, nearest, farthest]);
}

export function setSoundCutoff(sound: Sound, distance: number): void {
  boundWorld().log?.("SetSoundDistanceCutoff", [sound, distance]);
}

export function setSoundDuration(sound: Sound, milliseconds: number): void {
  const world = boundWorld();
  world.log?.("SetSoundDuration", [sound, milliseconds]);
  world.sounds.setDuration(asHandle(sound), milliseconds);
}

export function releaseWhenDone(sound: Sound): void {
  const world = boundWorld();
  world.log?.("KillSoundWhenDone", [sound]);
  world.sounds.killWhenDone(asHandle(sound));
}

// Headless decodes no sound file, so a file's length reads 0 until the window supplies it.
export function soundFileDuration(file: string): number {
  boundWorld().log?.("GetSoundFileDuration", [file]);
  return 0;
}

export function playMusic(file: string): void {
  const world = boundWorld();
  world.log?.("PlayMusic", [file]);
  world.sounds.playMusic(file);
}

export function stopMusic(fadeOut: boolean): void {
  const world = boundWorld();
  world.log?.("StopMusic", [fadeOut]);
  world.sounds.stopMusic();
}

export function clearMusic(): void {
  boundWorld().log?.("ClearMapMusic", []);
}

export function playTheme(file: string): void {
  const world = boundWorld();
  world.log?.("PlayThematicMusic", [file]);
  world.sounds.playMusic(file, false);
}

export function endTheme(): void {
  boundWorld().log?.("EndThematicMusic", []);
}

export function setVolumeGroup(group: VolumeGroup, scale: number): void {
  boundWorld().log?.("VolumeGroupSetVolume", [group, scale]);
}

export function resetVolumeGroups(): void {
  boundWorld().log?.("VolumeGroupReset", []);
}
