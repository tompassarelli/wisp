# Build profiles

`builds/<version>.<build>.json` records capabilities checked on that game
build. Host tools read it through `host/client/builds.ts`. A capability is
`supported`, `unsupported`, or `unchecked`; unchecked stops a dependent command
with the capability name and build. The registry supports Classic and
Definitive Edition.

`wisp client doctor` reads the executable version through the private plugin
and prints its profile before recovery. Menu connections identify the game
owning the socket; LAN hosts and provider switches use that build's profile
and protocol. Synthetic protocol checks use the registry's default build.
`WISP_GAME_BUILD` supplies an explicit build for command checks.

Profiles hold only behaviour observed from outside the game, as a player
sees it: menus, logs, replays, pictures and timing
([Principles](../README.md#principles)).

## Known builds

| Behavior | 3.0.0.24268 | 3.0.1.24342 | Issue |
| --- | --- | --- | --- |
| Offline LAN pool | Two clients play through the checked private provider switch | Provider absent; LAN games stop, solo games work | [wisp#37](https://github.com/tompassarelli/wisp/issues/37) |
| Game protocol | Checked version 10200 | No working LAN protocol checked | [wisp#37](https://github.com/tompassarelli/wisp/issues/37) |
| Equipment native names | Unprefixed 3.0 names | `Blz` names; heal, effect removal, talent reset and camera hotkey-lock declarations | [wisp#51](https://github.com/tompassarelli/wisp/issues/51) |
| Menu driving | Checked; wait 2500 ms after confirming a hosted lobby; Escape leaves results | Solo menu flow checked; same wait and Escape method until measured separately | [smashcraft#119](https://github.com/tompassarelli/smashcraft/issues/119), [wisp#37](https://github.com/tompassarelli/wisp/issues/37) |
| Classic and Definitive | Both supported | Both have pause/resume picture references | [wisp#84](https://github.com/tompassarelli/wisp/issues/84), [wisp#86](https://github.com/tompassarelli/wisp/issues/86) |
| Definitive assets | Stock model families | HD model paths need matching body textures | [wisp#84](https://github.com/tompassarelli/wisp/issues/84) |
| Ambient Occlusion | Removed from settings | Restored to settings | [smashcraft#287](https://github.com/tompassarelli/smashcraft/issues/287) |
| Terrain | `groundtile` supplies ground and blight | Newer terrain captures remain separate reference work | [wisp#82](https://github.com/tompassarelli/wisp/issues/82) |

Blizzard rolled the live install back to the first row on 9 October 2026.
Both sets of facts remain in the registry; the detected build selects behavior
([wisp#100](https://github.com/tompassarelli/wisp/issues/100)). A
capability without a checked result stays `unchecked`.

## Unknown builds

Doctor prints `unknown build` and stops. Check the new build's behaviour from
outside the game (menus, logs, a LAN lobby, a played map), then add
`builds/<version>.<build>.json` with each checked capability and its issue.
Every capability not checked stays `unchecked`.
