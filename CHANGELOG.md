# Changelog

Changes to what consumers may import: the subpaths `package.json` `exports`
declares (wisp:docs/architecture.md, "Where things live").

## 0.1

- `StandaloneOptions.sound` (`--sound`, read with `standaloneSoundArgument`) opens the native window's real output device; without it the window mixes every cue into nothing and `standalone.json` still records them, with `audioOutput` reading `none (silent by default)`. A game's player-facing launch passes it (wisp#264).
- `wisp/game/players` adds the local read `connectionRoundTripMs(player: Player): number`, this client's smoothed round trip to that player in whole ms as the transport measures it, or -1 for its own player, computers, offline matches and the Warcraft backend. `LockstepLink` gains an optional `roundTripMs(slot)`, which `TurnLedger` implements, and `ClientOptions` an optional `roundTripMs`. The transport's `pong` message now names the pinger's slot (`to`).
- The `warcraftNatives` option is gone from `installHeadless`, `HeadlessClient` and `Lockstep`: a Bun client holds only Wisp's `Wisp*` hooks, and only the 32-bit Lua clients of `wisp/src/headless/lua` (`luaLockstep`, `luaClient`, `warcraftLockstep`) hold the emulated Warcraft table. `wisp/game/input` has `MouseButton.right` (`MOUSE_BUTTON_TYPE_RIGHT`) and `wisp/game/frames` has `setFrameTextColor(frame, color)` (`BlzFrameSetTextColor`), the calls the last Bun tests needed to move onto the game API.
- `wisp/game/sound` has `playMusicFrom(file, from, fadeIn)` (`PlayMusicEx`), `resumeMusic()` (`ResumeMusic`) and `setMusicVolume(volume)` (`SetMusicVolume`), the calls the audio80 acceptance map needed to move onto the game API, so `wisp headless audio-acceptance` no longer gives its map Warcraft's natives.
- `makeNet` (`wisp/scripts/wisp/commands/net`) takes the game's native window command line as a fourth argument, which `net pair --relay local --window native --out DIR` starts for both players; `net pair` and `net proxy` take `--jitter MS`; and `StandaloneNetSession` may give `stages()`, the sim and rollback times since the window last asked, which the native window reports as it does for a local session.
- `wisp/game/players` has `playerColor(player)` (`GetHandleId(GetPlayerColor(player))`) and `wisp/game/bodies` has `createLocation(x, y)` (`Location`), the local read `locationZ(location)` (`GetLocationZ`, 0 on the native backend), `bodyX` and `bodyY` (`GetUnitX`, `GetUnitY`), the calls the animation58 and glow6 oracle maps needed to move onto the game API. The native backend's clock reads a binary32 span within binary32 rounding of whole frames as those frames, so `startTimer` with `f32(0.55)` fires on frame 33 as Warcraft's timer does, where it fired a frame late.
- `wisp/game/frames` has `OriginFrame.systemButton` (`ORIGIN_FRAME_SYSTEM_BUTTON`) and `frameId(frame)` (`GetHandleId`), a frame's number for a game's own tables, and a map on Bun reaches no Warcraft native, constant or variable: `installHeadless` installs only Wisp's `Wisp*` hooks unless its map sets `warcraftNatives: true`, and a headless client's `constants` holds the Warcraft constants its internals read.
- `wisp/game/frames` has the stock origin kinds `OriginFrame.commandButton`, `itemButton`, `heroBar`, `heroButton`, `heroHpBar`, `heroManaBar`, `heroButtonIndicator`, `minimap` and `minimapButton` (the `ORIGIN_FRAME_*` globals of the same names), so a game that hides the stock command card, hero bar and minimap by name reads them through `originFrame` instead of `BlzGetOriginFrame`.
- `wisp/game/frames` has `FrameEvent.mouseWheel` (`FRAMEEVENT_MOUSE_WHEEL`) and `eventFrameValue()` (`BlzGetTriggerFrameValue`, 120 a notch away from the user and -120 toward, 0 when no wheel event is firing): the native window sends a wheel turn over a frame that registered the event through the lockstep, one event per notch, and a pad script plays `wheel X Y DELTA`.
- `wisp/game/frames` has `createSimpleFrame(template, owner, context)`, and the bindings `generateFrames` writes use the game API (`Frame`, `FramePoint`, `loadFrameFile`, `createFrame` or `createSimpleFrame`, `namedFrame`, `setFrameAbsPoint`, `setFrameLevel`, `setFrameText`, `setFrameEnabled`) instead of raw `Blz` natives.
- `wisp/scripts/wisp/frames` exports `generateFrames` and `frameDefinitionProblems`, and `FrameDefinition` takes `type: "SIMPLEFRAME"` with `textures` (`SimpleTexture`: key, layer, file, texCoord, alphaMode, width, height, anchor) and an optional `children`.

- The families' handle and enumeration types are opaque (`Opaque<"Name">` in `wisp/src/game/opaque`), so a Warcraft handle no longer passes as a `Player`, `Frame`, `Effect` or the like. The enumerations have constants (`EffectAnimation`, `FramePoint`, `FrameEvent`, `TextAlignment`, `OriginFrame`, `CameraField`, `FilterBlendMode`, `FilterTexMapFlags`, `VolumeGroup`, `PlayerControl`, `PlayerSlotState`, `MouseButton`, `GameSpeed`), which `plugins/game-api.ts` lowers to the Warcraft global read and the native backend gives as values. `wisp/game/frames` re-exports `Events` from `wisp/game/events`.
- `wisp/game/clock` is Wisp's clock API (`createTimer`, `startTimer`, `pauseTimer`, `destroyTimer`, `localElapsed`, `setNormalSpeed`, `lockSpeed`, `gameSpeed`, `restartMatch`), lowered on Warcraft and run on Bun over a `Clock` store in `HeadlessClient.world` that counts whole frames and is stepped by `HeadlessClient.step`.
- `wisp/game/input` is Wisp's input API (`osKey`, `addKeyEvent`, `eventKey`, `keyDown`, `windowFocused`, `pointerX`/`pointerY`, `eventPointerX`/`eventPointerY`, `mouseDown`, `setPointer`, `showCursor`, `addChatEvent`, `chatText`, `addPointerMoveEvent`, `enableSelections`, `enableUserControl`). `HeadlessClient.world` carries an `input` store, which `client.input` exposes; `mouseScreenX`, `mouseScreenY` and `heldMouseButtons` read through it.
- `wisp/game/sync` is Wisp's sync-message API (`sendSync`, `addSyncEvent`, `syncData`, `syncPrefix`): delivery in the order sent, per sender, and a 255-character limit that the native backend enforces by throwing. `HeadlessClient.world` carries a `sync` store over the client's outbox.
- `wisp/game/bodies` is Wisp's unit and location API (`createBody`, the `setBody*` poses, `bodyKind` and the other local reads, `mapCenter`, `locationX`/`locationY`, `removeLocation`, and the calls that only set up Warcraft's unit), lowered on Warcraft and run on Bun over the `Bodies` store in `HeadlessClient.world`. The unit store moved from `wisp/src/headless/natives/units` to `wisp/src/game/native/bodyStore`; `UnitPose`, `UnitStateFixture` and `UnitStateFixtures` are declared in `wisp/src/game/native/types` and still re-exported from `wisp/src/headless/client`.
- `wisp/game/players` is Wisp's player API (`player`, `playerSlot`, `localPlayer`, `eventPlayer`, `playerControl`, `playerSlotState`, `playerName`, `setPlayerColor`, `addLeaveEvent`), and `Player` moved there from `wisp/game/effects` and `wisp/game/frames`. A lowering template may now name a global (`EVENT_PLAYER_LEAVE`) and a nested native (`ConvertPlayerColor($2)`); `HeadlessClient.world` carries a `players` store.
- `wisp/game/frames` and `wisp/game/events` are Wisp's UI frame, message, quest log and event-trigger APIs, lowered on Warcraft and run by the native backend on Bun like `wisp/game/effects`. `wisp/src/headless/frames` moved to `wisp/src/game/native/frameStore`.
- `wisp/game/sound` is Wisp's own sound API (sounds, music, volume groups): on Warcraft each call lowers to its native at compile time, on Bun it resolves to the native backend in `src/game/native/sound.ts`. The sound store moved from `wisp/src/headless/natives/sound` to `wisp/src/game/native/soundStore`, and `SoundCue` is declared in `wisp/src/game/native/types` (still re-exported from `wisp/src/headless/client`).
- `wisp/game/view` is Wisp's own camera and world-look API (camera fields, bounds, position and local reads, fog, sky, terrain visibility, day and night, shadow lights, the cinematic filter): on Warcraft it lowers to each call's native, on Bun it resolves to `src/game/native/view.ts`. `CameraPose`, `CineFilterPose` and `Environment` now come from `wisp/src/game/native/viewStore` (`CameraPose` and `CineFilterPose` stay re-exported from `wisp/src/headless/client`).
- `wisp/game/effects` is Wisp's own effects API (effects, beams and floating text): on Warcraft `plugins/game-api.ts` lowers each call to its native at compile time, on Bun it resolves to the native backend in `src/game/native`. `wisp/src/headless/animation`, `frameRate`, `lightnings` and `textTags` moved to `wisp/src/game/native`, and `Handle`, `EffectPose`, `EffectDeaths` and `HandleFactory` are no longer exported from `wisp/src/headless/client`.
- `wisp/game/text` is Wisp's own strings and math API (`formatInt`, `formatReal`, `formatRealWidth`, `parseInt`, `parseReal`, `toReal`, `truncate`, `textLength`), lowered on Warcraft to `I2S`, `R2S`, `R2SW`, `S2I`, `S2R`, `I2R`, `R2I` and `StringLength`. `describeNumber` is exported from `wisp/src/headless/client` as before but now lives in `wisp/src/game/native/textFormat`, and `wisp/src/headless/jassFormat` no longer exports `fixed` or `leadingNumber`.
- `wisp/game/files` is Wisp's own file-writing API (`clearFileLines`, `startFile`, `addFileLine`, `endFile` and `preloadAsset`): on Warcraft each call lowers to its Preload native, on Bun it resolves to `src/game/native/files.ts`, which hands the finished lines to the host without Warcraft's 259-byte line cut, and `preloadAsset` for an asset preload that writes no file.
- The native window reads pads at its sample point: `InputSample` carries `axisX` and `axisY`, `WindowView.selectPad` takes the browser's `gamepadIndex`, and `bun wisp play --standalone --window native` plays with the first connected pad (wisp#110).
- `wisp/src/netcode/ledger` now admits rows against the common frontier K
  with epochs, a participant mask, retained history, `discardThrough`,
  `takeLowestAccepted` and the receipts `wrongEpoch` and `storageFull`;
  `acceptRows` takes the epoch instead of the confirmed frame. New
  `capture`, `fixedSchedule` and `shadowSchedule` hold the lockstep and the
  speculative/confirmed cursor schedules, `frameRing` gains `ringVacant`,
  `ringRelease` and `ringClear`, and `session` is rebuilt over the schedule:
  `Session.present`, `confirmedFrame` and `pending` give way to
  `presentFrame`, `confirmedFrame` and `localRow` (wisp#96,
  wisp:docs/netcode.md).
- `wisp/scripts/wisp/standalone` takes `window: "native"` in `StandaloneOptions`
  and exports `standaloneWindowArgument` for a game's `--window chrome|native`
  flag; `bun wisp window probe` measures the window (wisp#105,
  wisp:docs/play.md, "Native window").
- `StandaloneOptions.emulatedCalls` names a JSON file a standalone run ends by writing its client's emulated-native call counts to, and `standaloneEmulatedCallsArgument` reads a game's `--emulated-calls FILE` flag; it is how a game API family's native-window check reads zero (wisp#137, wisp#138, wisp:docs/game-api-plan.md).

- `wisp/src/netcode/codec`, `frameRing`, `ledger`, `message`, `session` and
  `wire` export the generic rollback netcode Battlecraft proved: `RowCodec`,
  the per-player `FrameRing`, the `InputLedger` (including players who left),
  batched delta `encodeMessage`/`decodeMessage`, the wire varints, and the
  `Session` that predicts, rolls back and confirms (wisp#73,
  wisp:docs/netcode.md).
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
