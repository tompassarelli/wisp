# Changelog

Changes to what consumers may import: the subpaths `package.json` `exports`
declares (wisp:docs/architecture.md, "Where things live").

## Unreleased

- `wisp/scripts/wisp/syntheticBaseMap` exports `syntheticBaseMap` and
  `syntheticMapInfo`; `bun node_modules/wisp/host/compile/syntheticBaseMap.ts
  MAP_PACK OUT.w3x` writes the base map a consumer's CI builds its `.w3x`
  from, never one to play (wisp#72, wisp:docs/ci.md, "A synthetic base map
  for CI builds").
- `wisp/src/map/frameMeter` exports `FrameStamp`, and `startFrameMeter`
  takes `stamps`. Frame capture receipts gain `stamps=` in the heading and in
  each sample: `frameCostCaptureHeading` takes the stamp names and
  `frameCostCaptureSample` their values; `parseFrameCostCapture` returns
  `stamps` and each sample's `stamps`; `sectionTable` adds `sections`,
  `stamps` and the worst 1% of callbacks as `worst`, which
  `sectionTableLines` prints (wisp:docs/frame-cost.md, "A bounded native
  capture").
- `wisp/src/runtime/recordSlices` exports `FieldCursor`,
  `createFieldCursor`, `beginFieldSlices`, `writeFieldSlice` and
  `fieldSlicesOpen`, which write one field's record text in slices of a
  bounded number of steps, byte for byte the text of `writeFieldTokens`
  (wisp#55, wisp:docs/repro.md, "Saving state as record text").
- Removed: the relay mark. The relay no longer leads the first turn with a
  `WISP_RLY` sync action, `relayDelivery()` sends no opening message, and
  `wisp/src/headless/syncChannel` no longer exports `RELAY_MARK_PREFIX` or
  `RELAY_PROTOCOL_VERSION`, nor `SyncDelivery` an `opening`; a map cannot
  tell a relayed match from Battle.net (wisp:docs/relay.md, "No relay
  mark").
- The relay agent gives every Warcraft III the relay mark under the first
  map user slot no player holds, and none when the map has no such slot:
  under a player's own id the client closed at turn 0, and a sender that
  differed between clients desynced (wisp#37); a map must not read the
  mark's sync player.
- `relayDelivery()` leads the first turn with the relay mark, a sync message
  from the lowest slot with prefix `WISP_RLY` and the relay protocol version
  as data; `wisp/src/headless/syncChannel` exports `RELAY_MARK_PREFIX` and
  `RELAY_PROTOCOL_VERSION`, and `SyncDelivery` gains an optional `opening`
  (wisp:docs/network-model.md, "Relay delivery").
- `wisp/src/headless/syncChannel` exports `relayDelivery`, `relayCallbacks`,
  `MEASURED_RELAY`, `RELAY_LAG_STOP_MS`, `RELAY_CATCH_UP_STEP_MS`,
  `RELAY_SLEW_HOLD_MS` and the types `RelayTiming`, `RelayLink`,
  `RelayOutage` and `RelayDelivery` (wisp:docs/network-model.md, "Relay
  delivery").
- `wisp/src/runtime/recordText` exports `TokenLines`, `createTokenLines`,
  `openTokenLines`, `addToken`, `writeFieldTokens`, `addWrittenToken`,
  `addWrittenTokens` and `endTokenLine`, which write record text lines
  without a table or string per token (wisp:docs/repro.md).
- `wisp/src/map/frameSections` exports `beginFrameSection(index)` and
  `endFrameSection(index)`, and `startFrameMeter` takes `sections`. Frame
  capture receipts gain `sections=` in the heading and `gc-kb=` and
  `sections-us=` in each sample: `frameCostCaptureHeading` takes the section
  names, `frameCostCaptureSample` the heap change and section times, and
  `parseFrameCostCapture` returns `sections` and each sample's `gcKb` and
  `sectionsUs`. `wisp/scripts/wisp/frameCostCapture` adds `captureReceipt`,
  `sectionTable` and `sectionTableLines`.
- Classic is the only graphics mode. `Graphics` is `"classic"`, `AssetLayer`
  is `"base"`, `resolveRenderAsset(readers, path, graphics)` tries the map's
  import then the stock file and its result has no `bodyAlias`,
  `suffixConversion` or `selectedPath`, and `resolveAsset(path, graphics)`
  takes no body location. `RenderedFrame` drops `pointLights`, `absent`,
  `shadows.pointCasters`, `post` and `heightFog`. `withGraphicsMode` and
  `graphicsMode` take `"classic"` or `"reforged"`; the `capture-classic` and
  `capture-reforged` client profiles remain. `UnitModels` units are
  `{ id, path, scale }` with no `scaleTolerance`.
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
