# Changelog

Changes to what consumers may import: the subpaths `package.json` `exports`
declares (wisp:docs/architecture.md, "Where things live").

## Unreleased

- `exports` lists each importable module by name instead of the `./src/*`
  and `./scripts/*` directory wildcards: every subpath a consumer, the sample
  or a doc imports, plus `wisp/scripts/wisp/devResult` (`savedFiles()`) and
  `wisp/scripts/wisp/unitModels` (`compareUnitModels`). Any other module is
  internal, so knip reports what nothing uses. Scripts run by path
  (`bun node_modules/wisp/scripts/...`) are unaffected.
- The map-side services move from `src/platform/` to `src/map/` and are
  exported as `wisp/src/map/<module>`: dispatch, errors, fileio, frameMeter,
  hotReload, modelFailures, nativeDriver, repro and scene. The
  `wisp/src/platform/<module>` subpaths still resolve to them; import
  `wisp/src/map/<module>` in new code. The package ships their Lua under
  `src/map/`.
- `scripts/wisp/` groups its files into one directory per responsibility
  (`cli`, `io`, `compile`, `render`, `models`, `terrain`, `scene`, `headless`,
  `dev`, `testing`, `farm`, `client`, `play`, `accept`, `doctor`, `perf`,
  `repro`, `soak`, `tune`; Wisp's own program is `commands/repo.ts`). Every
  `wisp/scripts/wisp/<module>` subpath still resolves, to the module's new
  file. Scripts run by path move with them:
  `scripts/wisp/compile/lua32.ts`, `scripts/wisp/compile/ciMapBuild.ts` and
  `scripts/wisp/testing/testRunner.ts`.
- The host library moves from `scripts/` to `host/`, and the package ships
  `host/` instead of `scripts/`: `scripts/wisp/<dir>/` is `host/<dir>/`,
  `scripts/platform/` and `scripts/warcraft/` are `host/os/`, the compile
  chain (`compiler`, `luaBundle`, `mapInfo`, `mapScript`, `natives`,
  `numberRules`, `objectData`, `package`, `sourceMaps`, `handleWarnings`) is
  `host/toolchain/`, and `cleanRoom`, `mainRed` and `prePush` are
  `host/checks/`. Every `wisp/scripts/...` subpath, `wisp/scripts/wisp/cli`
  among them, still resolves, to the module's file under `host/`. Scripts
  run by path move with them: `host/compile/lua32.ts`,
  `host/compile/ciMapBuild.ts`, `host/testing/testRunner.ts` and
  `host/toolchain/numberRules.ts`.
