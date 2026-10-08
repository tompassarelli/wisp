# Audio events

Wisp records the map's sound and music calls in `HeadlessClient.soundLog`,
the same log used by `headless --sound-cues FILE.json`. Bun and the emitted
Lua32 bundle use the same native implementations. No sound files or Warcraft
client are needed to check which cue or stage track the map starts, stops or
mutes.

In a Wisp checkout, run the complete sound/music example:

```sh
bun wisp headless audio-acceptance --sound-cues /tmp/wisp-audio80.json --json
bun run test test/headless-sounds.test.ts -t 'spec #80'
```

The 48-frame map run emits 14 events per client, 28 across two clients. It
starts a looping sound and stage track at frame 0, sets both volumes to 64
at frame 6 and zero at frame 12, then stops both at frame 18. The track
resumes muted at frame 24, returns to volume 127 at frame 30, changes track
at frame 36 and stops at frame 42. The focused check asserts that exact
order, all frames, loop flags and numeric volumes. Its Lua32 twin runs with
the full suite through `bun wisp farm test --wait`.

## Event meanings

Each row has `client`, `frame`, `kind` (`sound` or `music`), `event`,
`source` or `label`, `looping`, `volume` and `effectiveVolume`. Sound rows
retain their handle, pitch and position. `volume` is the map's gain clamped
to 0–127; `effectiveVolume` is that gain divided by 127, so 127 is 1 and
mute is exactly 0. Volume set before playback appears on the start row;
volume set during playback adds a `volume` row. Muting keeps playback
running, and a later stop still records the track's identity.

`create` records a sound handle, `start` records accepted playback, `stop`
records the end of playing state, and `volume` records the gain while
playing. `StartSound` on a playing handle adds no second start. A nonlooping
sound with `SetSoundDuration` ends at the first frame reaching that duration
at its pitch; a looping sound waits for `StopSound`. The loop flag records
the playback mode; loop boundaries need asset duration and are not separate
map-call events.

`PlayMusic` and `PlayMusicEx` start a looping track; replacing a playing
track emits its stop before the new start. `StopMusic` records its call
frame, including when fade is requested. `ResumeMusic` starts the retained
track with its current volume. `SetMusicVolume(0)` emits effective volume 0
for a playing track, and a later start retains that mute. The events record
map-call timing and gain; device mixer settings, fade envelopes and audible
asset fidelity come from Warcraft reference captures.

`PlayThematicMusic` starts the requested track once (`looping: false`) in
the same music state and cue log, replacing the previous playing track.
It retains the map's music volume and the player's music slider.

## Player music volume

Warcraft's Options > Sound music slider scales the music channel; the map
cannot read it. `headless --music-volume V` (0 to 1, default 1) sets that
slider for every client: each `music` row's `effectiveVolume` is the map's
gain divided by 127, times V, and `sound` rows are unchanged. A track that
should follow the player's setting reads 1 at `--music-volume 1` and 0 at
`--music-volume 0`. In code, pass `musicSlider` to `runtime.clients` or the
`Lockstep` options.

## Game acceptance

From Smashcraft's `ts/`, after updating its Wisp pin:

```sh
bun wisp headless frozen-throne --sound-cues /tmp/smashcraft-stage-music.json --json
bun wisp headless quick-match --sound-cues /tmp/smashcraft-audio.json --json
```

The existing `frozen-throne` journey selects its stage through the map's
developer command and runs `MapMatchPresentation.playMusic(stageMusic(...))`.
Use its music rows for #271. The existing `quick-match` journey runs the
actual match presentation: music in
`kind: "music"` rows supports stage music #271, and sound source/label,
frame and gain in `kind: "sound"` rows support event sounds #82. For a
stage-specific journey, use `bun wisp headless --journey JOURNEY.json
--sound-cues FILE.json --json`; its chat events may select the stage before
starting the match. Assert the requested event-to-cue mapping against
`client.soundLog` in a game test, as the Wisp #80 focused check does.
