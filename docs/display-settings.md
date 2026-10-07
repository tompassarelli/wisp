# Display settings shared by a prefix: doctor and play

Warcraft III keeps its display settings (window mode, window size and
position, render resolution, frame rate cap, refresh rate) in the `[Video]`
section of `Documents/Warcraft III/War3Preferences.txt` and rewrites the file
when it exits, with the values it ran with. A client on a private desktop and
a `wisp play` run on the owner's display can share one Wine prefix, so a run on
the owner's display leaves the private desktop's next game with the owner's
display settings. On 6 Oct that was a 3:2 render in a 2160x1440 area, which
broke native bot sessions (the sky check, pointer moves).

## Doctor restores a client's declared settings

A client of the clients file may declare `displaySettings`, the `[Video]` keys
and values its display needs:

```json
{ "name": "a", "run": "...", "documents": "...", "menuReportPort": 47124,
  "displaySettings": { "windowmode": "2", "windowwidth": "1920", "windowheight": "1080",
    "windowx": "320", "windowy": "180", "reswidth": "1280", "resheight": "720",
    "refreshrate": "60", "maxfps": "200" } }
```

While Warcraft III is closed, `wisp client doctor` compares them with the file. A
difference is the state **display settings changed**: doctor writes the
declared values into the `[Video]` section, keeps every other line, and prints
the keys it found changed.

```text
a: display settings changed: War3Preferences.txt no longer holds this client's display settings (windowmode is 1, expected 2, reswidth is 2880, expected 1280); a run on another display rewrites them when Warcraft III exits; restoring the display settings
```

A running game's file is left alone (it rewrites it on exit, and settings
only apply at launch). A client declaring nothing is not checked. Because
`play`, `accept` and the bot sessions run doctor first, a client is launched
with its declared settings.

## Play puts the file back

Before `wisp play` starts Warcraft III it saves `War3Preferences.txt` as
`War3Preferences-before-play.txt` beside it, and starts a detached helper
(wisp:scripts/wisp/restorePreferences.ts) that waits for the game's process to
exit and then puts the saved file back and removes the backup. The helper
outlives `play`, which returns while the game runs. Main-display play so
never leaves the shared prefix's settings changed, with or without a
declaration.

- A backup left by an earlier play whose helper never ran (the machine went
  down with the game) is the file to keep: play writes it back first and keeps
  it for the new helper.
- A declaration may name the owner's display settings (`PlayDeclaration.displaySettings`, the same `[Video]` keys as a client's). Play writes them into the file before saving it, so the backup and the game both carry them. On 7 Oct the owner's file held a test desktop's windowed 1920x1080 settings left by an earlier run outside `play`; play saved them and the helper put them back each time.
- A declaration may also name `recommendedSettings` (graphics quality, frame cap). Play writes each one only when the file has no entry for that key, after the declared display settings, so a value the owner chose is never replaced.
- A game already running when `play` starts has its own backup and helper;
  play saves and starts nothing for it.
- The whole file goes back, so preference changes made during the session
  (Gameplay options, for instance) are undone with the display settings.

Tests: wisp:test/doctor.test.ts (the state, with the trimmed preference files
in wisp:test/fixtures/preferences; main-display.txt's values are constructed
from the 6 Oct report), wisp:test/play.test.ts (the save and helper start) and
wisp:test/preferences.test.ts (the helper on real files). Whether Warcraft III
on the owner's display rewrites exactly these keys is a property of the real
game that only a native run shows.
