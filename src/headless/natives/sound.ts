import type { Sounds } from "../../game/native/soundStore";
import type { Handle } from "../../game/native/types";
import type { NativeBehavior } from "../clientTypes";
import type { Unit } from "./units";

export function soundNatives(sounds: Sounds): Readonly<Record<string, NativeBehavior>> {
  return {
    CreateSound: (source: string, loop: boolean) => sounds.create(source, undefined, loop),
    CreateSoundFromLabel: (label: string, loop: boolean) => sounds.create(undefined, label, loop),
    CreateSoundFilenameWithLabel: (source: string, loop: boolean, _is3D: boolean, _stop: boolean, _fadeIn: number, _fadeOut: number, label: string) => sounds.create(source, label, loop),
    SetSoundDuration: (handle: Handle, duration: number) => sounds.setDuration(handle, duration),
    GetSoundDuration: (handle: Handle) => sounds.duration(handle),
    GetSoundIsPlaying: (handle: Handle) => sounds.isPlaying(handle),
    KillSoundWhenDone: (handle: Handle) => sounds.killWhenDone(handle),
    StopSound: (handle: Handle, killWhenDone: boolean) => sounds.stop(handle, killWhenDone),
    SetSoundParamsFromLabel: (handle: Handle, label: string) => sounds.setLabel(handle, label),
    SetSoundVolume: (handle: Handle, volume: number) => sounds.setVolume(handle, volume),
    PlayMusic: (source: string) => sounds.playMusic(source),
    PlayMusicEx: (source: string) => sounds.playMusic(source),
    PlayThematicMusic: (source: string) => sounds.playMusic(source, false),
    StopMusic: () => sounds.stopMusic(),
    ResumeMusic: () => sounds.resumeMusic(),
    SetMusicVolume: (volume: number) => sounds.setMusicVolume(volume),
    SetSoundPitch: (handle: Handle, pitch: number) => sounds.setPitch(handle, pitch),
    SetSoundPosition: (handle: Handle, x: number, y: number, z: number) => sounds.setPosition(handle, x, y, z),
    AttachSoundToUnit: (handle: Handle, unit: Unit) => sounds.attachToUnit(handle, unit),
    StartSound: (handle: Handle) => sounds.start(handle),
    StartSoundEx: (handle: Handle) => sounds.start(handle),
  };
}
