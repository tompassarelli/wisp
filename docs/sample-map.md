# Start a map from the sample

The sample map in [wisp:examples/sample/](https://github.com/tompassarelli/wisp/tree/main/examples/sample)
is the second map built on Wisp, the starting point for a new Wisp map and the
reference map for toolchain comparisons. It is not part of the installed
package; read it in the repository. Its behavior is fixed so ports stay
comparable:

- two player slots; one custom Wisp Rider per player spawns at the playable area's center, using a Knight model and the typed unit definition;
- a 0.1 s periodic timer moves each unit along a square lap around the center,
  computed by one pure function, `pathPoint` in src/path.ts;
- the chat command `-ping` prints a counter to every player;
- a typed two-level Blizzard ability; the first rider has level 1, the second level 2. `-objects` prints the unit names, levels and tooltips and writes `sample-objects.txt` for an offline check;
- one unit test for `pathPoint`, run in Bun and in 32-bit Lua;
- a [headless](headless.md) two-client journey: start, `-ping`, a hot reload,
  another `-ping` and more frames, with the same native calls in both clients,
  and the same in Bun as in 32-bit Lua.

| File | What it shows |
| --- | --- |
| src/path.ts | Synchronized math with `floorDiv`/`floorMod` only, so every client computes the same positions. |
| src/path.tests.ts | A test registered with `test()` from wisp:src/runtime/testing.ts, so it runs in both runtimes. |
| src/main.ts | The map entry: `start()` creates the units, the timer and the chat trigger once, through `trampoline()`; `install()` configures the runtime and registers every handler, at start and after each hot reload. Match state is a global. |
| test/path.test.ts, test/lua.ts | The Bun test file: the registered tests in Bun, then compiled with tsconfig.tests.json and run in the Lua that `LUA` names. |
| test/journey.ts | The headless journey and what it needs to know about the map, declared once for Bun and Lua. |
| test/headless.test.ts, test/headless-lua.ts | The journey in two simulated clients of the map's TypeScript in Bun, then of its compiled bundle in the Lua that `LUA` names, compiled with tsconfig.headless.json; both print the same result. |
| test/fixtures/desync.ts, test/failing-fixture.test.ts | A deliberately desyncing copy of the map that the headless journey must fail on: the failing case of the [consumer CI](ci.md) check. |
| scripts/sample.ts | The map's program: `map build`, `map rebuild`, `hot`, `fresh`, `client` and `headless`, composed from Wisp's services with `runCli`. |
| scripts/objects.ts, src/objectIds.ts | [Typed object authoring](object-data.md): one unit and a two-level ability, with the same named numeric IDs used by map code. The build prints object-generation time and includes FileIO. |
| tsconfig.json, tsconfig.map.json, tsconfig.tests.json, tsconfig.headless.json | Host scripts and tests, which also see the natives and Lua's types because the headless test imports map code; the map bundle; the Lua test bundle; the Lua headless bundle. |

## Run it

From the Wisp checkout, with Bun at the version in wisp:typescript-toolchain.lock:

```sh
bun install --frozen-lockfile
bun test examples/sample
bun examples/sample/scripts/sample.ts map build --base BASE.w3m --out OUT_DIR/wisp-sample.w3x
```

`bun examples/sample/scripts/sample.ts headless [--clients N]` plays the
headless journey and prints each client's native calls and checksum and any
problem. `LUA`, when set, must be Lua 5.3 built with `LUA_32BITS`; unset, the
tests build and cache the pinned one (wisp:scripts/wisp/lua32.ts). The output must be outside the
checkout. The build also needs `nix` on first use: it links nixpkgs `lua5_3`,
which checks the script's syntax, into wisp:build/tools/lua and compiles the map
packager from wisp:native/map-pack.c against nixpkgs StormLib into
wisp:build/tools/map-pack, again whenever that source changes. The packager
only reads the base map and container (they may be read-only); the build
stages the map in a copy of its own process and renames it into `--out`, so
concurrent builds never share a partial file.

Build and rebuild print [handle cleanup warnings](handle-cleanup.md) with
source file and line for unmatched `Location`/`CreateGroup` calls. Escaped or
conditional ownership is labeled UNKNOWN. Headless journeys can inspect each
client's `liveHandleCounts()` before allocation and after cleanup.

## The base map

Base maps stay outside the repository. A base map is a Warcraft III World
Editor map (war3map.w3i format 39) saved with Lua as its script language. The
build keeps its terrain, size, tileset, camera bounds and other files, and
replaces its name, description, players and forces with the map declaration
in scripts/sample.ts. Its war3map.lua must define `main()` and `config()` once
and call `RunInitializationTriggers()` once, as World Editor writes it; the
build suppresses that call, so the default melee trigger never runs. The
sample builds from a 16 KB, one-slot base with that default trigger and no
imports.

The build packages into a copy of the base. It adds war3map.w3a holding
FileIO's ability, which hot reload needs, and the 512-byte map header when the
base was saved without one. Imported assets can be added directly to the base:
when its MPQ hash table is full, the packager doubles that table and retries
the addition once. Existing entries stay in the archive. A map may still pass
`--container` to retain assets from another packaged map; growth happens only
on the staged output, never on the base or container.

## Play it and change it while it runs

These commands drive signed-in clients on private desktops. `WISP_CLIENTS`
names the clients file (default ~/.local/state/wisp/clients.json):

```json
{
  "tools": { "grim": "/path/grim", "xdotool": "/path/xdotool", "wlrctl": "/path/wlrctl", "tesseract": "/path/tesseract" },
  "clients": [
    { "name": "a", "run": "/run/user/1000/private-desktop.A", "documents": "/path/to/Documents/Warcraft III" },
    { "name": "b", "run": "/run/user/1000/private-desktop.B", "documents": "/path/to/Documents/Warcraft III" }
  ]
}
```

A client may add `profile` (`minimal`, the default, `visual` or `player`; [doctor.md](doctor.md#graphics-profiles)) and `displaySettings`, the `[Video]` keys of War3Preferences.txt its display needs over its profile's, which `doctor` writes ([display-settings.md](display-settings.md)). Each `run` directory holds its desktop's `display`, `xauthority` and
`wayland-display` files. Each client also needs `menuReportPort` and the menu
page installed ([driving-warcraft.md](driving-warcraft.md)). The first client hosts.

1. `bun examples/sample/scripts/sample.ts fresh MAP.w3x` installs the map as
   the only map of each client's Maps/00-Wisp folder, leaves any game, hosts
   a private game from the first client through its menu page, joins the
   others by name and password, starts, and waits until every client
   acknowledges the match start. A client without a reporting page stops it
   first: a game hosted by clicks is listed publicly. It first creates each client's
   `sample-hot` folder in CustomMapData, as `hot` does, so the map's lookups for
   reloads stay cheap ([polling cost](hot-reload.md#what-polling-costs)). `--map-folder FOLDER`
   installs and hosts from another folder under Maps. `--rebuild` replaces the
   script first.
2. `bun examples/sample/scripts/sample.ts hot --data CLIENT_A/CustomMapData --data CLIENT_B/CustomMapData --watch`
   compiles each save and installs it in every client on one frame.
3. `bun examples/sample/scripts/sample.ts client chat a -ping` prints `ping 1`
   in both clients.
4. Change `ping ${sample.pings}` to `pong ${sample.pings}` in src/main.ts and
   save. The watcher prints `vN running in 2 client(s)`; the next `-ping`
   prints `pong 2`, and the units keep walking from where they were.

A runtime error in a handler appears in game and, with TypeScript lines, in
the watcher's output.

## Make it your own map

Copy examples/sample into a new project and install the package generated for
a Wisp revision ([README](../README.md#consume-a-pinned-revision)). Declare the
versions in wisp:typescript-toolchain.lock in the project's package.json
(`packageManager`, `typescript`, `typescript-native`, `typescript-to-lua`,
`effect`, `@effect/tsgo`), plus `lua-types` and `@types/bun`; the build checks
the declared and installed versions. Then:

- remove `paths` from the four tsconfig files: `wisp/...` imports resolve
  through the installed package;
- name the natives `node_modules/wisp/src/natives/warcraft.d.ts` in
  tsconfig.json and tsconfig.map.json; in tsconfig.map.json,
  tsconfig.tests.json and tsconfig.headless.json, set `rootDir` to `.` and name
  the plugin `./node_modules/wisp/plugins/warcraft-numbers.ts`;
- run the number rules in the project's type-check after `tsc --build`:
  `bun node_modules/wisp/scripts/numberRules.ts tsconfig.map.json tsconfig.tests.json tsconfig.headless.json`;
  for the editor, add the plugin entry from the [feature index](index.md)
  to the tsconfig the editor uses for src/;
- in scripts/sample.ts, make `root` the project root, compile inputs
  `src` and `node_modules/wisp/src`, and point `toolchainLockPath` at the
  project's own lock file;
- choose the map's name, declaration, `configureRuntime()` prefixes and the
  matching host `filePrefix`, and the same prefixes in test/journey.ts;
- run the headless Lua bundle with
  `node_modules/wisp/src/natives/warcraft.d.ts` as its declarations.
