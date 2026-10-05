# Start a map from the sample

The sample map in [wisp:examples/sample/](https://github.com/tompassarelli/wisp/tree/main/examples/sample)
is the second map built on Wisp, the starting point for a new Wisp map and the
reference map for toolchain comparisons. It is not part of the installed
package; read it in the repository. Its behavior is fixed so ports stay
comparable:

- two player slots; one Footman per player spawns at the playable area's center;
- a 0.1 s periodic timer moves each unit along a square lap around the center,
  computed by one pure function, `pathPoint` in src/path.ts;
- the chat command `-ping` prints a counter to every player;
- one unit test for `pathPoint`, run in Bun and in 32-bit Lua.

| File | What it shows |
| --- | --- |
| src/path.ts | Synchronized math with `floorDiv`/`floorMod` only, so every client computes the same positions. |
| src/path.tests.ts | A test registered with `test()` from wisp:src/runtime/testing.ts, so it runs in both runtimes. |
| src/main.ts | The map entry: `start()` creates the units, the timer and the chat trigger once, through `trampoline()`; `install()` configures the runtime and registers every handler, at start and after each hot reload. Match state is a global. |
| test/path.test.ts, test/lua.ts | The Bun test file: the registered tests in Bun, then compiled with tsconfig.tests.json and run in the Lua that `LUA` names. |
| scripts/sample.ts | The map's program: `build`, `rebuild`, `hot`, `fresh` and `client`, composed from Wisp's services with `runCli`. |
| tsconfig.json, tsconfig.map.json, tsconfig.tests.json | Host scripts and tests; the map bundle; the Lua test bundle. |

## Run it

From the Wisp checkout, with Bun at the version in wisp:typescript-toolchain.lock:

```sh
bun install --frozen-lockfile
LUA=/path/to/lua32 bun test examples/sample
bun examples/sample/scripts/sample.ts build --base BASE.w3m --out OUT_DIR/wisp-sample.w3x
```

`LUA` must be Lua 5.3 built with `LUA_32BITS`. The output must be outside the
checkout. The build also needs `nix`: it checks the script's syntax with
nixpkgs `lua5_3`, and on first use compiles the map packager from
wisp:native/map-pack.c against nixpkgs StormLib into wisp:build/tools/map-pack.

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
base was saved without one. A map with imported assets passes `--container`, a
packaged map whose archive has room for them.

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

Each `run` directory holds its desktop's `display`, `xauthority` and
`wayland-display` files. The first client hosts. Screen positions assume a
2560x1440 client.

1. `bun examples/sample/scripts/sample.ts fresh MAP.w3x` installs the map as
   the only map of each client's Maps/00-Wisp folder, leaves any game, hosts
   from the first client, joins the others by name, starts, and waits until
   every client acknowledges the match start. Create Game selects the first map
   of the folder its list has open, and Warcraft keeps that folder for the
   session: open Maps/00-Wisp once in the host's list, or pass
   `--map-folder FOLDER` naming the folder it shows. `--rebuild` replaces the
   script first; `--from-game` leaves a running game through its menu.
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

- remove `paths` from the three tsconfig files: `wisp/...` imports resolve
  through the installed package;
- in tsconfig.map.json and tsconfig.tests.json, set `rootDir` to `.`, name the
  natives `node_modules/wisp/src/natives/warcraft.d.ts` and the plugin
  `./node_modules/wisp/plugins/warcraft-numbers.ts`;
- in scripts/sample.ts, make `root` the project root, compile inputs
  `src` and `node_modules/wisp/src`, and point `toolchainLockPath` at the
  project's own lock file;
- choose the map's name, declaration, `configureRuntime()` prefixes and the
  matching host `filePrefix`.
