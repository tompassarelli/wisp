import { f32 } from "../../sim/f32";
import { FRAMES_PER_SECOND } from "./frameRate";
import type { Handle, HandleFactory, SoundCue } from "./types";

interface Place {
  readonly x: number;
  readonly y: number;
}

interface SoundState {
  readonly kind: "sound" | "music";
  readonly handle: Handle;
  readonly source: string | undefined;
  label: string | undefined;
  volume: number;
  pitch: number;
  x: number;
  y: number;
  z: number;
  unit: Place | undefined;
  readonly looping: boolean;
  duration: number;
  elapsed: number;
  playing: boolean;
  killWhenDone: boolean;
}

export function assertSoundCue(log: readonly SoundCue[], expected: { readonly source?: string; readonly label?: string; readonly frame?: number; readonly count?: number }): void {
  let count = 0;
  for (const cue of log) {
    if (cue.event !== "start") continue;
    if (expected.source !== undefined && cue.source !== expected.source) continue;
    if (expected.label !== undefined && cue.label !== expected.label) continue;
    if (expected.frame !== undefined && cue.frame !== expected.frame) continue;
    count++;
  }
  if (count !== (expected.count ?? 1)) throw new Error(`sound cue ${expected.source ?? expected.label ?? "any"}: expected ${expected.count ?? 1} starts, got ${count}`);
}

export class Sounds {
  readonly log: SoundCue[] = [];
  private readonly sounds = new Map<Handle, SoundState>();
  private music: SoundState | undefined;
  private musicVolume = 127;

  constructor(private readonly handle: HandleFactory, private readonly musicSlider: number, private readonly frame: (this: void) => number) {}

  create(source: string | undefined, label: string | undefined, looping: boolean): Handle {
    const handle = this.handle("sound");
    const sound: SoundState = { kind: "sound", handle, source, label, volume: 127, pitch: 1, x: 0, y: 0, z: 0, unit: undefined,
      looping, duration: 0, elapsed: 0, playing: false, killWhenDone: false };
    this.sounds.set(handle, sound);
    this.cue(sound, "create");
    return handle;
  }

  private cue(sound: SoundState, event: SoundCue["event"]): void {
    this.log.push({ event, kind: sound.kind, frame: this.frame(), handle: sound.handle, source: sound.source, label: sound.label,
      volume: sound.volume, effectiveVolume: sound.volume / 127 * (sound.kind === "music" ? this.musicSlider : 1), looping: sound.looping,
      pitch: sound.pitch, x: sound.unit?.x ?? sound.x, y: sound.unit?.y ?? sound.y, z: sound.z });
  }

  private stopVoice(sound: SoundState): void {
    if (!sound.playing) return;
    this.cue(sound, "stop");
    sound.playing = false;
  }

  playMusic(source: string, looping = true): void {
    if (this.music !== undefined) this.stopVoice(this.music);
    this.music = { kind: "music", handle: { kind: "music", id: 0 }, source, label: undefined,
      volume: this.musicVolume, pitch: 1, x: 0, y: 0, z: 0, unit: undefined, looping,
      duration: 0, elapsed: 0, playing: true, killWhenDone: false };
    this.cue(this.music, "start");
  }

  stopMusic(): void {
    if (this.music !== undefined) this.stopVoice(this.music);
  }

  resumeMusic(): void {
    if (this.music === undefined || this.music.playing) return;
    this.music.playing = true;
    this.cue(this.music, "start");
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(127, volume));
    if (this.music === undefined) return;
    this.music.volume = this.musicVolume;
    if (this.music.playing) this.cue(this.music, "volume");
  }

  start(handle: Handle): void {
    const sound = this.sounds.get(handle);
    // A handle has one voice: starting it while it plays changes nothing.
    if (sound === undefined || sound.playing) return;
    this.cue(sound, "start");
    sound.elapsed = 0;
    sound.playing = sound.looping || sound.duration > 0;
    if (!sound.playing && sound.killWhenDone) this.sounds.delete(handle);
  }

  stop(handle: Handle, killWhenDone: boolean): void {
    const sound = this.sounds.get(handle);
    if (sound === undefined) return;
    this.stopVoice(sound);
    if (killWhenDone || sound.killWhenDone) this.sounds.delete(handle);
  }

  killWhenDone(handle: Handle): void {
    const sound = this.sounds.get(handle);
    if (sound === undefined) return;
    sound.killWhenDone = true;
    if (!sound.playing) this.sounds.delete(handle);
  }

  setDuration(handle: Handle, duration: number): void {
    const sound = this.sounds.get(handle);
    if (sound !== undefined) sound.duration = Math.max(0, duration);
  }

  duration(handle: Handle): number {
    return this.sounds.get(handle)?.duration ?? 0;
  }

  // A sound marked for destruction reads as not playing while it plays out.
  isPlaying(handle: Handle): boolean {
    const sound = this.sounds.get(handle);
    return sound !== undefined && sound.playing && !sound.killWhenDone;
  }

  setLabel(handle: Handle, label: string): void {
    const sound = this.sounds.get(handle);
    if (sound !== undefined) sound.label = label;
  }

  setVolume(handle: Handle, volume: number): void {
    const sound = this.sounds.get(handle);
    if (sound === undefined) return;
    sound.volume = Math.max(0, Math.min(127, volume));
    if (sound.playing) this.cue(sound, "volume");
  }

  setPitch(handle: Handle, pitch: number): void {
    const sound = this.sounds.get(handle);
    if (sound !== undefined) sound.pitch = f32(pitch);
  }

  setPosition(handle: Handle, x: number, y: number, z: number): void {
    const sound = this.sounds.get(handle);
    if (sound === undefined) return;
    sound.x = f32(x);
    sound.y = f32(y);
    sound.z = f32(z);
    sound.unit = undefined;
  }

  attachToUnit(handle: Handle, unit: Place): void {
    const sound = this.sounds.get(handle);
    if (sound !== undefined) sound.unit = unit;
  }

  tick(): void {
    for (const sound of this.sounds.values()) {
      if (!sound.playing || sound.looping) continue;
      sound.elapsed += sound.pitch * 1000 / FRAMES_PER_SECOND;
      if (sound.elapsed < sound.duration) continue;
      this.stopVoice(sound);
      if (sound.killWhenDone) this.sounds.delete(sound.handle);
    }
  }
}
