import type { SoundCue } from "../../src/headless/clientTypes";
import type { SoundAsset } from "../render/standaloneSound";
import type { NativeAudio } from "./audio";

export interface SoundFigures {
  readonly audioEvents: number;
  readonly audioReadyEvents: number;
  readonly audioPlayed: number;
  readonly audioDecodedAssets: number;
  readonly missingSounds: readonly string[];
  readonly audioOutput: string;
}

export interface SoundPlayer {
  /** Takes one step's cues: each resolves to a file, decodes once per resolved path and, for a `start`, plays at the cue's volume and pitch. */
  cues(cues: readonly SoundCue[]): void;
  /** Waits for every cue taken so far, then reports what the run heard. */
  settle(): Promise<SoundFigures>;
}

/** The native window's counterpart of the page's `sound` function (wisp:host/browser/standalone.ts), with the same counts. */
export function createSoundPlayer(resolve: (cue: SoundCue) => Promise<SoundAsset | undefined>, audio: NativeAudio): SoundPlayer {
  const resolved = new Map<string, Promise<string>>();
  const pending = new Set<Promise<void>>();
  const missing = new Set<string>();
  let events = 0, ready = 0, played = 0;
  const assetOf = (cue: SoundCue) => {
    const key = `${cue.source ?? cue.label}:${cue.handle.id}`;
    let asset = resolved.get(key);
    if (asset === undefined) {
      asset = resolve(cue).then((found) => {
        if (found === undefined) throw new Error(`missing sound: ${cue.source ?? cue.label}`);
        const path = found.path.replaceAll("\\", "/").toLowerCase();
        audio.load(path, found.bytes);
        return path;
      });
      resolved.set(key, asset);
    }
    return asset;
  };
  return {
    cues(cues) {
      for (const cue of cues) {
        events++;
        const task = assetOf(cue).then((path) => {
          ready++;
          if (cue.event !== "start") return;
          if (audio.play(path, cue.volume, Math.max(0.01, cue.pitch))) played++;
        }).catch((cause: unknown) => { missing.add(cause instanceof Error ? cause.message : String(cause)); });
        pending.add(task);
        void task.finally(() => pending.delete(task));
      }
    },
    async settle() {
      while (pending.size > 0) await Promise.all([...pending]);
      const info = audio.info();
      return { audioEvents: events, audioReadyEvents: ready, audioPlayed: played, audioDecodedAssets: info.decoded, missingSounds: [...missing], audioOutput: info.output };
    },
  };
}
