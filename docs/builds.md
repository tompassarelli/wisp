# Build profiles

`builds/<version>.<build>.json` records capabilities checked on that game
build. Host tools read it through `scripts/wisp/builds.ts`. A capability is
`supported`, `unsupported`, or `unchecked`; unchecked stops a dependent command
with the capability name and build. The registry supports Classic and
Definitive Edition.

`wisp client doctor` reads the executable version through the private plugin
and prints its profile before recovery. Menu connections identify the game
owning the socket; LAN hosts and provider switches use that build's profile
and protocol. Synthetic protocol checks use the registry's default build.
`WISP_GAME_BUILD` supplies an explicit build for command checks.

`padDriver` means the private native in-map `engine drive` path. The ordinary
external pad helper and headless scripted inputs do not require that capability;
their working comparison results remain valid. `frameNumberRead` means a raw
native frame-number read, separate from a map's own journal frame stamps.

Private binary details live outside every checkout at
`~/.local/share/wisp-private/builds/<version>.<build>.json`, with
`{ id, engine, lan, notes, offsets }`. `engine` holds measured locator facts;
`offsets` holds the debugger's unchanged offset entry; `lan` holds provider
patch information. Public profiles hold no binary bytes or offsets.

## Known builds

| Behavior | 3.0.0.24268 | 3.0.1.24342 | Issue |
| --- | --- | --- | --- |
| Offline LAN pool | Two clients play through the checked private provider switch | Provider absent; LAN games stop, solo games work | [wisp#37](https://github.com/tompassarelli/wisp/issues/37) |
| Game protocol | Checked version 10200 | No working LAN protocol checked | [wisp#37](https://github.com/tompassarelli/wisp/issues/37) |
| Engine presence table | Debugger reads the checked layout | Same layout, moved image location | [wisp#76](https://github.com/tompassarelli/wisp/issues/76) |
| Equipment native names | Unprefixed 3.0 names | `Blz` names; heal, effect removal, talent reset and camera hotkey-lock declarations | [wisp#51](https://github.com/tompassarelli/wisp/issues/51) |
| Menu driving | Checked; wait 2500 ms after confirming a hosted lobby; Escape leaves results | Solo menu flow checked; same wait and Escape method until measured separately | [smashcraft#119](https://github.com/tompassarelli/smashcraft/issues/119), [wisp#37](https://github.com/tompassarelli/wisp/issues/37) |
| Classic and Definitive | Both supported | Both have pause/resume picture references | [wisp#84](https://github.com/tompassarelli/wisp/issues/84), [wisp#86](https://github.com/tompassarelli/wisp/issues/86) |
| Definitive assets | Stock model families | HD model paths need matching body textures | [wisp#84](https://github.com/tompassarelli/wisp/issues/84) |
| Ambient Occlusion | Removed from settings | Restored to settings | [smashcraft#287](https://github.com/tompassarelli/smashcraft/issues/287) |
| Terrain | `groundtile` supplies ground and blight | Newer terrain captures remain separate reference work | [wisp#82](https://github.com/tompassarelli/wisp/issues/82) |

Blizzard rolled the live install back to the first row on 9 October 2026.
Both sets of facts remain in the registry; the detected build selects behavior
([wisp#100](https://github.com/tompassarelli/wisp/issues/100)). A driver or
frame-number read without a checked result stays `unchecked`.

## Unknown builds

Doctor prints `unknown build`, invokes the private discovery provider at
`~/.local/share/wisp-private/builds/discover.ts`, and writes
`<id>.draft.json` beside the private profiles. The provider performs passive
engine locate, an offline LAN-provider probe and menu observation. It starts
no client and makes no game-memory changes. Unavailable steps remain pending.
The draft lists every capability needing checking and grants none from an
unsuccessful probe. Populate the private profile and add a public profile with
the checked behavior and its issue.
