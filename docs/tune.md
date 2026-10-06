# Live tuning: `wisp tune`

`wisp tune` serves a panel on this computer that changes a running match's
declared values: speeds, jump heights, knockback, frame counts. Each change is
a [hot reload](hot-reload.md): every client installs it on the same frame, or
none does, and the panel shows the time from the change to every client
running it. **Keep** writes the running value into the source; **Reset** puts
back the value the session started with, in the match and in the source.

## Declare the values

A tunable is a number literal in the map's source, named by a path from a
top-level variable through object literal properties. The literal may be the
one argument of a call such as `f32(...)` or a unit conversion:

src/game/tuning.ts:

```ts
export const PHYSICS: Physics = {
  hero: { runSpeed: melee(2.200000047683716), jumpSquatFrames: 3 },
};
export const KNOCKBACK_GROWTH: number = 100.0;
```

```ts
import type { Tunable } from "wisp/scripts/wisp/tune";

export const TUNABLES: readonly Tunable[] = [
  { name: "Hero run speed", group: "Hero", file: "src/game/tuning.ts", path: ["PHYSICS", "hero", "runSpeed"], kind: "f32", min: 0.5, max: 4.0, step: 0.01 },
  { name: "Hero jump squat", group: "Hero", file: "src/game/tuning.ts", path: ["PHYSICS", "hero", "jumpSquatFrames"], kind: "int", min: 1, max: 10, step: 1 },
  { name: "Knockback growth", file: "src/game/tuning.ts", path: ["KNOCKBACK_GROWTH"], kind: "f32", min: 25, max: 300, step: 1 },
];
```

- `kind: "f32"` values run as binary32: the panel's value is rounded to the
  nearest binary32 and written as that value's exact decimal
  (`2.2` becomes `2.200000047683716`, `3` becomes `3.0`), which the
  [number rules](../plugins/number-rules.ts) accept and Lua reads as a float.
  `kind: "int"` values are 32-bit integers, written without a decimal point.
- A value outside `min` to `max` is refused; `step` is the slider's.
- `group` is the panel's heading.

The project composes the command with
[makeTune](../scripts/wisp/commands/tune.ts) (wisp:scripts/wisp/commands/tune.ts),
as it does `hot`, plus the directory the files are relative to:

```ts
export const tune = makeTune({ project, sourceDirectory, sourceMapDirectory, filePrefix: "mygame", root: projectDirectory, tunables: TUNABLES });
```

`tune --data A --data B [--port N]` takes each client's CustomMapData folder,
like `hot`, and prints the panel's address, `http://127.0.0.1:7341/` by
default.

## How a change reaches the match

The [Tune service](../scripts/wisp/tune.ts) (wisp:scripts/wisp/tune.ts)
keeps the value each tunable runs. A change replaces the literals that differ
from the file's in a copy of the file's text, and the
[map compiler](../scripts/compiler.ts) compiles that text in place of the
file. Such a compile writes nothing, so the bundle on disk is always the
source's and a later map build never packages a value nobody kept. The
compile changes only the declaration's module, and
[what a reload sends](hot-reload.md#what-a-reload-sends) is a delta of that
module alone once every client has acknowledged a version from this `tune`.
The first change of a session sends the full payload, as a restarted `hot`
does.

`tune` compiles the map once when it starts (about 7 s on Smashcraft), so a
change waits only for the module it changes. Measured on Smashcraft (170
modules) on 6 October 2026, from the panel's request to both acknowledgements
of two fake clients that acknowledge as soon as their files appear, ten
changes of each of five tunables (run speed, jump squat frames, a Demon
Hunter jump speed, knockback growth, hitstun per knockback): medians 101 to
139 ms, every change a delta of one module (about 16-20 KB of a 1.28 MB full
payload); the session's first change, a full payload, 383 ms. A client adds
its polling and synchronized answers, about 0.3 s on the
[sample map](hot-reload.md#what-a-reload-sends), and a delta's load, about
5.5 ms in 32-bit Lua.

Give a tunable declaration a type that doesn't name its value (`: number`, an
interface): a `const` whose type is its literal (`export const GROWTH =
100.0`) makes every importer type-check again on each change. It still
sends only the declaration's module, but Smashcraft's knockback growth
compiled in 1.3 to 2.4 s that way, and in about 0.1 s typed `number`.

A reload links every module again, so module-scope tables built from a
tunable take its new value. A value the game copied into match state, such
as a record each fighter received when it was created, keeps the old value
until the game's `install()` puts the new one there. `install()` runs on the
same frame in every client, so the game reapplies such records there, as it
reapplies [object data](hot-reload.md). Smashcraft gives every fighter its
authored tuning again, in the confirmed match, the speculative match and its
rollback history (smashcraft:ts/src/platform/shell/tuning.ts).

A match started with a tuned value can't be replayed from its inputs alone:
the inputs don't record the change.

## Keep and Reset

**Keep** reads the file, replaces that one literal with the running value
and prints the change as a unified diff, the same `git diff` shows:

```text
--- a/src/game/tuning.ts
+++ b/src/game/tuning.ts
@@ -1,4 +1,4 @@
 export const PHYSICS: Physics = {
-  hero: { runSpeed: melee(2.200000047683716), jumpSquatFrames: 3 },
+  hero: { runSpeed: melee(2.5), jumpSquatFrames: 3 },
 };
 export const KNOCKBACK_GROWTH: number = 100.0;
```

Nothing else in the file changes. The match already runs the value, so Keep
sends no reload. **Reset** writes the literal's original text back when the
source differs and reloads the starting value when the match runs another.
Edits made elsewhere in the file meanwhile stay; each change reads the file
again, and a change refuses a tunable whose literal is gone.

## Boundaries

- One program publishes to a client's hot folder at a time: stop `hot
  --watch` or `dev --data` before starting `tune` against the same clients,
  and the other way round. A restarted publisher continues from the newest
  version on disk.
- `tune` changes map code only. A value only one client's presentation reads
  applies the same way, in every client. A value a program outside the map
  reads, such as an input helper's constant, is not a tunable: change it in
  that program's source and restart it.
- The panel listens on 127.0.0.1 and loads nothing from the network. It
  answers only requests that name its own address and post JSON, so another
  site open in the browser can't change values or write the source.

## Headless

wisp:test/tune.test.ts applies a value through `Tune` to a compiled fixture
map and plays the result in two 32-bit Lua clients: a delta of the
declaration's module alone, installed on the same tick in both, whose step
changes alike in both from then on. In Bun, where a reload installs an entry
rather than Lua modules, `runtime.modules(entry)` ([headless](headless.md#hot-reload))
publishes a version that installs another entry, such as the map imported
from a copy of its sources holding the texts `tune` compiles.
