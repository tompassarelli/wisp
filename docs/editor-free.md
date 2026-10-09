# TypeScript map authoring without World Editor

Start with Wisp's source-owned [sample](sample-map.md). It contains the
smallest complete supported example: a chat trigger, two moving units, typed
unit/ability object data, a map declaration and a two-client headless journey.
No editor or Warcraft client is needed for the commands below.

Use Bun 1.3.13, Git and Nix. Supply your own Lua base map outside the checkout;
see [base-map requirements](sample-map.md#the-base-map). The base supplies
terrain and map metadata; this route replaces its initialization with the
TypeScript entry. A base already saved with Lua can be reused without opening
World Editor. Wisp does not supply Blizzard maps, models or textures. This
example references the installed Knight model by path and imports no art.
Custom assets and built maps must also stay in private storage outside Git.

## Start, build and run

From a fresh Wisp checkout, these are the supported commands. Replace the
base path with your own compatible file; keep the output outside the checkout.

```sh
git clone https://github.com/tompassarelli/wisp.git wisp
cd wisp
bun install --frozen-lockfile
mkdir -p "$HOME/.local/state/wisp/editor-free"
bun examples/sample/scripts/sample.ts map build \
  --base /private/base.w3m \
  --out "$HOME/.local/state/wisp/editor-free/sample.w3x"
bun examples/sample/scripts/sample.ts headless ping-reload --clients 2 --json
```

The build compiles `examples/sample/src/main.ts` to Lua, generates
`war3map.w3u` and `war3map.w3a`, and packages them into a copy of the base.
The headless command runs the same TypeScript source in two simulated clients;
it does not read the packaged `.w3x` or load installed art. Its 120-frame
journey sends `-ping` at frames 30 and 90 with a reload at frame 60. Expect
`ping 1` and `ping 2`, continued square-lap movement, equal client checksums,
zero errors and a final JSON summary with `ok: true`.

## Author the trigger and object data

Edit `examples/sample/src/main.ts`. The existing trigger is:

```ts
const chat = CreateTrigger();
for (let player = 0; player < 2; player++)
  TriggerRegisterPlayerChatEvent(chat, Player(player), "-ping", true);
TriggerAddAction(chat, trampoline("sample.ping"));
```

`install()` registers `on("sample.ping", ping)`; `ping()` increments the
global match counter and calls `DisplayTextToForce`. `start()` creates the
trigger once. Keeping callbacks behind `trampoline()` lets the headless
journey replace handlers without recreating triggers on reload.

Edit `examples/sample/scripts/objects.ts` for build-time object data:

```ts
export const walker = new UnitObject(WALKER_ID, "hfoo")
  .name(WALKER_NAME).tooltip("A rider walking the sample lap.")
  .model(WALKER_MODEL).scale(1.25).hitPoints(420).movementSpeed(180)
  .abilities([SNOW_ID]).build();
```

That file also authors a two-level `AbilityObject(SNOW_ID, "AHbz")`, and
`sampleObjectData()` encodes both archive entries. Shared IDs live in
`src/objectIds.ts`; `start()` creates `WALKER_ID` and sets the ability level
to `player + 1`. See [typed object data](object-data.md) for supported fields.
Re-run `map build` after object-data changes; `map rebuild MAP.w3x` replaces
only Lua. Headless's walking journey deliberately ignores ability levels;
the real map's `-objects` command displays names, levels and tooltips and
writes `sample-objects.txt` ([sample](sample-map.md)).

For a separate project, follow [Make it your own map](sample-map.md#make-it-your-own-map)
to consume a pinned Wisp package and adjust imports/configuration. The sample
is repository source, rather than an installed-package scaffold.

## Recipe run on 9 October 2026

Ran from a fresh Wisp worktree at `b516ed9`, with Bun 1.3.13 and no
existing dependencies or build tools in that worktree. The private base was
`~/.local/share/smashcraft-build-inputs/physics-base.w3m` (16,814 bytes), and
the output was `~/.local/state/wisp/editor-free/sample.w3x`.

| Command above | Exit | Observed result |
| --- | --- | --- |
| `bun install --frozen-lockfile` | 0 | 34 packages installed; pinned checker patched. |
| `map build --base … --out …` | 0 | Built the map in 6.228 s; verified 19 archive entries after generating object data and compiling Lua. |
| `headless ping-reload --clients 2 --json` | 0 | 120 frames, 134 native calls per client, equal checksum `-123668497`, zero errors, zero missing natives, summary `ok: true`, 1 result and 0 failures. |

The expected chat/reload/movement sequence completed headless in 0.175 s.
Object-data names and ability tooltips are packaged for Warcraft; this
headless journey checks the walking and chat path, rather than reading those
archive fields.
