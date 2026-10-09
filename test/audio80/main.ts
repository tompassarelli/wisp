export function install(this: void): void {}


export function start(this: void): void {
  const cue = CreateSound("Imported\\Hit.ogg", true, false, false, 0, 0, "");
  SetSoundDuration(cue, 50);
  StartSound(cue);
  SetMusicVolume(127);
  PlayMusic("Imported\\Stage.ogg");
  const at = (frame: number, action: (this: void) => void) => TimerStart(CreateTimer(), frame / 60, false, action);
  at(6, () => { SetSoundVolume(cue, 64); SetMusicVolume(64); });
  at(12, () => { SetSoundVolume(cue, 0); SetMusicVolume(0); });
  at(18, () => { StopSound(cue, true, false); StopMusic(false); });
  at(24, () => ResumeMusic());
  at(30, () => SetMusicVolume(127));
  at(36, () => PlayMusicEx("Imported\\NextStage.ogg", 0, 0));
  at(42, () => StopMusic(true));
}
