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
