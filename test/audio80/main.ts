import { createTimer, startTimer } from "wisp/game/clock";
import { createSound, playMusic, playMusicFrom, playSound, resumeMusic, setMusicVolume, setSoundDuration, setSoundVolume, stopMusic, stopSound } from "wisp/game/sound";

export function install(this: void): void {}

export function start(this: void): void {
  const cue = createSound("Imported\\Hit.ogg", true, false, false, 0, 0, "");
  setSoundDuration(cue, 50);
  playSound(cue);
  setMusicVolume(127);
  playMusic("Imported\\Stage.ogg");
  const at = (frame: number, action: (this: void) => void) => startTimer(createTimer(), frame / 60, false, action);
  at(6, () => { setSoundVolume(cue, 64); setMusicVolume(64); });
  at(12, () => { setSoundVolume(cue, 0); setMusicVolume(0); });
  at(18, () => { stopSound(cue, true, false); stopMusic(false); });
  at(24, () => resumeMusic());
  at(30, () => setMusicVolume(127));
  at(36, () => playMusicFrom("Imported\\NextStage.ogg", 0, 0));
  at(42, () => stopMusic(true));
}
