<p align="center"><img src="https://github.com/user-attachments/assets/45df1931-752f-42bf-8597-3917320004e1" alt="Wisp logo" width="360"></p>

# Wisp

**Warcraft III modding at warp speed.**

Modern tooling, testing, build automation, and developer experience for Warcraft III modding.

Wisp compiles TypeScript into Warcraft III's Lua, applies the game's numeric
rules, reloads code into running clients, maps Lua errors back to TypeScript,
and runs a map in simulated clients without Warcraft. Games own their
simulation, UI, assets and map declaration; Wisp never reads their source.
[Smashcraft](https://github.com/tompassarelli/smashcraft) is the first
consumer.

## Respecting Blizzard's IP

Wisp works with your own Warcraft III install. It never copies or ships
anything of Blizzard's.

- **Nothing of theirs in the repo.** No Blizzard code, art, models,
  textures, sounds, music, data tables, game scripts (the bodies of
  `common.j` and `blizzard.j`) or in-game text. Players load art from their
  own legally owned install when Wisp runs. Native names and signatures are
  the interface maps call, and a short quote that identifies something is
  fine.
- **Behaviour from the outside only.** Wisp's behaviour comes from
  observing the game as a player sees it (pictures, sound, the logs and
  files the game writes, replays, timing, the LAN traffic of games we host)
  and from public documentation. Never from disassembly, decompilation,
  decrypted or dumped executables, debugger sessions, or reading the game's
  memory.
- **No bypassing, no cheating.** No DRM bypass, no Battle.net sign-in
  emulation, no cheating or anti-cheat evasion, and nothing that touches
  other players' games or Blizzard's services.
- **Private test tools stay private.** Two local tools exist only for
  testing on our own machines and test accounts: the LAN switch that lets
  our own test clients offer LAN games, and the desync debugger that
  inspects our own clients. They live outside every repository, under
  `~/.local/share/wisp-private/`, and never feed Wisp's implementation.
  Their addresses, offsets, dumps, byte patterns and procedures are never
  committed, posted in issues or pull requests, or quoted in docs. What
  they show may help diagnose our own bugs (such as a desync); it never
  decides how Wisp behaves.
- **Names.** "Warcraft" stays out of product names and logos. "Works with
  your Warcraft III install" is fine.
- **No Warsmash code.** Warsmash is AGPL; Wisp uses none of its code.

The long form, and the check that enforces it before every push, is
[docs/clean-room.md](docs/clean-room.md).

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
from a checkout with `bun scripts/package.ts /absolute/path/to/wisp.tgz`.
It contains the authored TypeScript, its emitted Lua and declarations, and
this documentation.

## Where to look next

- [Feature index](docs/index.md): every command and capability, with setup
  and costs. Check it before building something new.
- [AGENTS.md](AGENTS.md): rules for working in this repository.

## License

Wisp is released under the [MIT License](LICENSE). Warcraft III and its assets
belong to Blizzard Entertainment and are not part of this repository.
