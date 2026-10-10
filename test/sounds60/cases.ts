export const SOUND_PATH = "Sound\\Interface\\QuestNew.wav";

export const SOUND_NATIVES = () => ({
  GetSoundFileDuration: (path: string) => (path === SOUND_PATH ? 2000 : 0),
});

const CONCURRENT = 12;

function cue(this: void, looping: boolean, duration: number): sound {
  const created = CreateSound(SOUND_PATH, looping, false, false, 10, 10, "DefaultEAXON");
  SetSoundDuration(created, duration);
  SetSoundVolume(created, 0);
  return created;
}

export function soundCases(this: void, done: (this: void, rows: readonly string[]) => void): void {
  const rows: string[] = [];
  const duration = GetSoundFileDuration(SOUND_PATH);
  if (duration <= 0) {
    done([`missing-file=${SOUND_PATH}`]);
    return;
  }
  const length = duration / 1000.0;
  const at = (seconds: number, run: (this: void) => void) => TimerStart(CreateTimer(), seconds, false, () => {
    DestroyTimer(GetExpiredTimer());
    run();
  });

  const warm = cue(false, duration);
  StartSound(warm);
  KillSoundWhenDone(warm);
  const start = 0.5;

  at(start, () => {

    const again = cue(false, duration);
    StartSound(again);
    at(length * 0.5, () => StartSound(again));
    at(length * 1.25, () => rows.push(`start-while-playing-at-1.25=${GetSoundIsPlaying(again)}`));

    const restart = cue(false, duration);
    StartSound(restart);
    at(length * 0.5, () => {
      StopSound(restart, false, false);
      StartSound(restart);
    });
    at(length * 1.25, () => rows.push(`stop-then-start-at-1.25=${GetSoundIsPlaying(restart)}`));

    const killed = cue(false, duration);
    StartSound(killed);
    KillSoundWhenDone(killed);
    at(length * 0.5, () => rows.push(`kill-when-done-at-0.5=${GetSoundIsPlaying(killed)}`));
    at(length * 1.25, () => {
      StopSound(killed, false, false);
      StartSound(killed);
      rows.push(`released-handle-started=${GetSoundIsPlaying(killed)}`);
    });

    const stopped = cue(false, duration);
    StartSound(stopped);
    KillSoundWhenDone(stopped);
    at(length * 0.25, () => {
      StopSound(stopped, false, false);
      StartSound(stopped);
    });
    at(length * 0.5, () => rows.push(`stopped-kill-when-done-restarted=${GetSoundIsPlaying(stopped)}`));

    const fast = cue(false, duration);
    SetSoundPitch(fast, 2.0);
    StartSound(fast);
    at(length * 0.25, () => rows.push(`pitch-two-at-0.25=${GetSoundIsPlaying(fast)}`));
    at(length * 0.75, () => rows.push(`pitch-two-at-0.75=${GetSoundIsPlaying(fast)}`));

    const loop = cue(true, duration);
    StartSound(loop);
    at(length * 0.5, () => StopSound(loop, false, true));
    at(length, () => {
      rows.push(`fade-stopped-loop-at-1=${GetSoundIsPlaying(loop)}`);
      StartSound(loop);
    });
    at(length * 1.25, () => {
      rows.push(`fade-stopped-loop-restarted=${GetSoundIsPlaying(loop)}`);
      StopSound(loop, true, false);
    });

    const concurrent: sound[] = [];
    for (let index = 0; index < CONCURRENT; index++) {
      const each = cue(false, duration);
      StartSound(each);
      KillSoundWhenDone(each);
      concurrent.push(each);
    }
    at(length * 0.5, () => {
      let playing = 0;
      for (const each of concurrent) if (GetSoundIsPlaying(each)) playing++;
      rows.push(`same-file-playing=${playing}/${CONCURRENT}`);
    });

    at(length * 1.5, () => done(rows));
  });
}
