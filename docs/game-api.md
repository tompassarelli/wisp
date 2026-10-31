# Game API

Wisp's own game API is the contract that gameplay and presentation code calls, shaped for this game and not for Warcraft III's natives. The plan, its order and the measurements that prove each family are in [game-api-plan.md](game-api-plan.md). This page documents the families that exist.

A family is a module `wisp/game/<family>`. Its declarations are `src/game/<family>.d.ts`. On Warcraft, `plugins/game-api.ts` drops the import and rewrites each call as the native call that the family's table in `src/game/warcraft/<family>.ts` names, so a migrated call costs what the native call cost. On Bun the import resolves to `src/game/native/<family>.ts`, which reads the world a host has bound (`src/game/native/world.ts`).

Add the plugin after `warcraft-numbers.ts` in a map's `luaPlugins`:

```json
"luaPlugins": [
  { "name": "./node_modules/wisp/plugins/warcraft-numbers.ts" },
  { "name": "./node_modules/wisp/plugins/game-api.ts" }
]
```

An API function used as a value (passed, stored) is a compile error (TS9310), because under Lua no function exists to pass. Code that treats natives as values stays on raw natives.

## Lowering table format

`export const <family>: Lowering` maps each exported function name to a template `Native($1, $2, false)`: one native call whose arguments are the call's arguments (`$n`, 1-based, each at most once and in order) or the literals `false`, `true` or an integer. `parseTemplate` in `src/game/warcraft/lowering.ts` defines the grammar, and `test/game-api.test.ts` checks every row against `src/natives/warcraft.d.ts` and the native backend.

## Native backend and the call log

A host binds the world it is about to run with `bindWorld(world)`: `host/headless` binds each client's world around that client's turns. Each native backend call logs the native name and arguments of its table row to `world.log`, which only the headless client installs, so `callHash.ts` and each game's `localNatives` keep their native names. Outside headless nothing is logged.

## Effects

`wisp/game/effects`: effects (`createEffect`, `destroyEffect`, position, scale, matrix, orientation, alpha, colour, animation, time and blend calls, `effectX`/`effectY`/`effectZ` local reads, `effectScale`), beams (`createBeam`, `moveBeam`, `setBeamColor`, `destroyBeam`) and floating text (`createFloatingText`, `setFloatingText*`). The stores are `src/game/native/effectStore.ts`, `lightnings.ts` and `textTags.ts`. `Effect`, `Beam`, `FloatingText`, `Player` and `EffectAnimation` alias Warcraft's `effect`, `lightning`, `texttag`, `player` and `animtype` until the families that own them become opaque.

## Frames

`wisp/game/frames`: frame creation (`createFrame` from a template the game ships, `createFrameByType` with a `FrameKind`), tree and name reads (`originFrame`, `namedFrame`, `frameChild`, `frameChildCount`, `frameName`), every setter the Warcraft frame natives have (position, size, scale, level, alpha, colour, texture, text, font, alignment, visibility, enabling, focus, and `setFrameModel`, `setFrameSpriteAnimation` and `setFrameSpriteTime` for a frame that shows a model), the local reads `frameText`, `frameEnabled`, `frameVisible`, `screenWidth` and `screenHeight`, `frameColor` (the signed ARGB word of a colour), `addFrameEvent(events, frame, event)` with the event reads `eventFrame`, `eventFrameEvent` and `eventFrameText`, the message area (`displayText`, `displayTimedText`, `clearTextMessages`, `debugMessage`) and the quest log (`createQuest`, `setQuest*`). The frame tree is `src/game/native/frameStore.ts` and its calls are `frameUi.ts`, which the emulated Warcraft natives in `src/headless/natives/frames.ts` run too. `Quests` (`quests.ts`) holds the quest log, and a headless test reads `client.quests.entries()` where Warcraft would draw the log. A frame, point, event, alignment, origin and player value is the Warcraft handle or constant of the same name until step 6 of the plan, so `FRAMEPOINT_TOPLEFT` and `Player(0)` still come from the natives. The native backend refuses to register one frame event twice on the same events.

## Events

`wisp/game/events`: `createEvents()`, `onEvents(events, handler)` and `destroyEvents(events)`. The trigger store is `src/headless/natives/triggersTimers.ts`, which implements `EventStore` (`src/game/native/eventStore.ts`) for the native backend; its sources other than frames (keys, sync, chat, leave) stay raw natives on an events value until their own family moves.

## Sound

`wisp/game/sound`: sounds (`createSound`, `soundFromLabel`, `playSound`, `stopSound`, `setSoundVolume`/`Pitch`/`Position`/`Distances`/`Cutoff`/`Duration`, `releaseWhenDone`, `soundFileDuration`), music (`playMusic`, `stopMusic`, `clearMusic`, `playTheme`, `endTheme`) and volume groups (`setVolumeGroup`, `resetVolumeGroups`). The store is `src/game/native/soundStore.ts`; its cue log reaches `host/window/soundPlayer.ts` through the client's `soundLog`. The native backend keeps the attenuation range, the cutoff, the volume groups and `clearMusic`/`endTheme` only in the call log, because the window mixes with rules of its own, and `soundFileDuration` reads 0 because headless decodes no file. `Sound` and `VolumeGroup` alias Warcraft's `sound` and `volumegroup` until the families that own them become opaque; the `SOUND_VOLUMEGROUP_*` constants stay raw globals until the constants box.

## Text

`wisp/game/text`: `formatInt`, `formatReal`, `formatRealWidth`, `parseInt`, `parseReal`, `toReal`, `truncate` and `textLength`, which lower to `I2S`, `R2S`, `R2SW`, `S2I`, `S2R`, `I2R`, `R2I` and `StringLength`. They are pure, so the native backend (`src/game/native/text.ts`) needs no world: it logs its row's native only when a headless client is bound. The formatting rules are in `src/game/native/textFormat.ts`, and `src/game/native/text.tests.ts` runs the same table of values in Bun and in 32-bit Lua.

The rules, which both backends keep:

- `formatReal` prints the value as binary32 with three decimals and rounds an exact tie away from zero (0.0625 prints `0.063`, -0.0625 prints `-0.063`), keeping negative zero. Replays and records are text, and a replay recorded on one backend must read alike on the other, so the native backend does not use the host's own number formatting.
- `formatRealWidth` pads on the left to `width + 1` characters and keeps at least one decimal, so a precision of 0 prints `1.0` for 0.5.
- `parseInt` skips leading spaces, reads a sign and digits and stops at the first other character, and truncates toward zero; `parseReal` does not skip spaces, reads one fraction point and returns the binary32 value.
- `truncate` rounds toward zero.
