<p align="center"><img src="https://github.com/user-attachments/assets/45df1931-752f-42bf-8597-3917320004e1" alt="Wisp logo" width="360"></p>

# Wisp

**Warcraft III development at warp speed.**

Modern tooling, testing, build automation, and developer experience for Warcraft III modding.

Wisp compiles TypeScript into Warcraft III's Lua, applies the game's numeric
rules, reloads code into running clients, maps Lua errors back to TypeScript,
and runs a map in simulated clients without Warcraft. Games own their
simulation, UI, assets and map declaration; Wisp never reads their source.
[Smashcraft](https://github.com/tompassarelli/smashcraft) is the first
consumer.

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
