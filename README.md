<p align="center"><img src="https://github.com/user-attachments/assets/45df1931-752f-42bf-8597-3917320004e1" alt="Wisp logo" width="360"></p>

# Wisp

**Warcraft III modding at warp speed.**

Modern tooling, testing, build automation, and developer experience for Warcraft III modding.

Warcraft III is still a great platform for custom games, but its modding tools
are dated and the official editor has barely changed. Wisp lets you write a map
in TypeScript and gives it modern tooling. The map still runs in the real game.

What it does for any map:

- **Write in TypeScript.** Wisp compiles it to the Lua that Warcraft runs.
  Warcraft API types catch mistakes before the map loads, and a Lua error in
  the game points back to your TypeScript line.
- **Hot reload.** Save a file and the running match picks up the code change,
  with no rebuild or rehost. New art and object data still need a rebuilt map.
- **Build without World Editor.** Define units and abilities in code; one
  command packs the map.
- **Test without Warcraft.** Simulated players run your map in seconds and
  report errors, desyncs and what a player would see wrong. `wisp dev` reruns
  them on every save.
- **Automate playtests.** Host a match from the desktop in one command, or run
  offline LAN matches with no Battle.net account.

The simulator is the runtime: Wisp's own from-scratch implementation of the
game's rules. It exists for fast testing and, for games that opt in, a
standalone browser player. It does not replace Warcraft III.

Wisp runs on Linux today; Windows and macOS support is tracked in
[wisp#108](https://github.com/tompassarelli/wisp/issues/108). Games own their
simulation, UI, assets and map declaration; Wisp never reads their source.
[Smashcraft](https://github.com/tompassarelli/smashcraft) is the first game
built on it.

## Principles

Wisp is an independent fan project, not affiliated with or endorsed by Blizzard
Entertainment. Its toolchain works with the official game and your own install.
Its runtime, like [OpenMW](https://openmw.org) for Morrowind, is written
entirely from scratch and loads art at run time from a copy you own; Wisp never
replaces or redistributes the game.

- **Respect copyright and publisher IP.** Nothing of Blizzard's (code, art,
  sound, data, game scripts or in-game text) is in this repository or ships
  with Wisp. Art loads at run time from your own install.
- **Learn by observation.** Wisp's behaviour is measured from the outside: what
  the game shows, plays, logs and writes, and the traffic of LAN games we host,
  plus public documentation. Never from disassembly, decompilation or the
  game's memory.
- **Emulate a declared profile, not Warcraft.** Standalone mode runs only
  the natives a game declares in its [standalone profile](docs/headless.md#standalone-profile),
  never Warcraft's unit simulation; a map that needs Warcraft to move, path,
  order, fight or buff its units plays in Warcraft only.
- **Play fair.** No DRM bypass, no Battle.net emulation, no cheats, and nothing
  that touches other players or Blizzard's services.
- **Original work.** Our own code only. No code from AGPL projects such as
  Warsmash, and "Warcraft" stays out of our product names.

The detailed rules, and the automated check that enforces them on every push,
are in [docs/clean-room.md](docs/clean-room.md).

## Start

To make a new map, begin with the [sample map](docs/sample-map.md). Keep
`wisp dev` running while you change code: each save reports type errors,
affected tests and simulated matches ([the dev loop](docs/dev.md)).

To develop Wisp itself, from the checkout root:

```sh
bun install --frozen-lockfile
LUA=/path/to/lua32 bun run test
```

The tests need Lua 5.3 built with `LUA_32BITS`, matching Warcraft's 32-bit
numbers.

## Consume a pinned revision

A game records an immutable Wisp commit and installs the package generated
from it through Bun; no registry release is needed. Generate that package
from a checkout with `bun host/toolchain/package.ts /absolute/path/to/wisp.tgz`.
It contains the authored TypeScript, its emitted Lua and declarations, and
this documentation. Import only the subpaths its `exports` declares; their
changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Where to look next

- [Feature index](docs/index.md): every command and capability, with setup
  and costs. Check it before building something new.
- [AGENTS.md](AGENTS.md): rules for working in this repository.

## License

Wisp is released under the [MIT License](LICENSE). Warcraft III and its assets
belong to Blizzard Entertainment and are not part of this repository.

<small>Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard
Entertainment, Inc.</small>
