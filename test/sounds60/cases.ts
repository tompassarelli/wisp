// wisp#60's sound rules: one row per rule Smashcraft relies on
// (wisp:docs/warsmash-notes.md#sound-start-stop-and-channel-limits). Headless
// runs and the native capture map play this same code and write the same rows.

/** A stock interface sound; every case's timing is a fraction of its length, so any length over 0.4 s works. */
export const SOUND_PATH = "Sound\\Interface\\QuestNew.wav";

/** Headless decodes no sound files: the tests give the fixture's file this length, in milliseconds. */
export const SOUND_NATIVES = () => ({
  GetSoundFileDuration: (path: string) => (path === SOUND_PATH ? 2000 : 0),
});

/** Handles of one file started in the same call by the channel case. */
const CONCURRENT = 12;

function cue(this: void, looping: boolean, duration: number): sound {
  const created = CreateSound(SOUND_PATH, looping, false, false, 10, 10, "DefaultEAXON");
  SetSoundDuration(created, duration);
  SetSoundVolume(created, 0);
  return created;
}

/** Runs every case and passes the rows to `done` once the last sample is read. */
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

  // A first play may wait on loading the file, so the cases start half a second later.
  const warm = cue(false, duration);
  StartSound(warm);
  KillSoundWhenDone(warm);
  const start = 0.5;

  at(start, () => {
    // Starting a handle that is still playing neither restarts it nor adds a voice:
    // it ends with its first start.
    const again = cue(false, duration);
    StartSound(again);
    at(length * 0.5, () => StartSound(again));
    at(length * 1.25, () => rows.push(`start-while-playing-at-1.25=${GetSoundIsPlaying(again)}`));

    // StopSound then StartSound in one call restarts from the beginning.
    const restart = cue(false, duration);
    StartSound(restart);
    at(length * 0.5, () => {
      StopSound(restart, false, false);
      StartSound(restart);
    });
    at(length * 1.25, () => rows.push(`stop-then-start-at-1.25=${GetSoundIsPlaying(restart)}`));

    // KillSoundWhenDone on a playing handle lets it play out, then releases it;
    // stopping or starting the released handle does nothing.
    const killed = cue(false, duration);
    StartSound(killed);
    KillSoundWhenDone(killed);
    at(length * 0.5, () => rows.push(`kill-when-done-at-0.5=${GetSoundIsPlaying(killed)}`));
    at(length * 1.25, () => {
      StopSound(killed, false, false);
      StartSound(killed);
      rows.push(`released-handle-started=${GetSoundIsPlaying(killed)}`);
    });

    // A stopped handle that was set to be killed is released by the stop.
    const stopped = cue(false, duration);
    StartSound(stopped);
    KillSoundWhenDone(stopped);
    at(length * 0.25, () => {
      StopSound(stopped, false, false);
      StartSound(stopped);
    });
    at(length * 0.5, () => rows.push(`stopped-kill-when-done-restarted=${GetSoundIsPlaying(stopped)}`));

    // Pitch 2 plays twice as fast.
    const fast = cue(false, duration);
    SetSoundPitch(fast, 2.0);
    StartSound(fast);
    at(length * 0.25, () => rows.push(`pitch-two-at-0.25=${GetSoundIsPlaying(fast)}`));
    at(length * 0.75, () => rows.push(`pitch-two-at-0.75=${GetSoundIsPlaying(fast)}`));

    // A looping handle stopped with a fade-out is stopped later; starting it again plays.
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

    // Many handles of one file started in one call each play.
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
