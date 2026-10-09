# Shadow Strike: a narrow field reference

This is the source-owned example for [#94](https://github.com/tompassarelli/wisp/issues/94).
It copies the stock base ID `AEsh` into two original ability IDs, `A94a`
and `A94b`; those are object IDs, not field IDs. No extracted game records,
scripts, assets or maps are included.

Field identity, editor type and data column were independently read from
the owner's private `Units/AbilityMetaData.slk` on 9 October 2026. The
native interface declarations supply the descriptive names for `Esh1`–`Esh5`.
The metadata extraction's install build was not independently recorded;
it is not a native behavior observation.

## Fields written by this example

Object-file levels are **one-based** (`level: 1` here). Unleveled fields
use level 0. The `BlzGet/SetAbility…LevelField` native APIs use **zero-based**
indices, so object level 1 is native index 0. Data columns identify Data
A/B/C/D/E as 1/2/3/4/5; ordinary fields use 0. `unreal` is binary type 2,
stored as binary32, distinct from binary type 1 `real`.

| Display name / descriptive identity | Raw field | Value type | Units / meaning | Level; column |
| --- | --- | --- | --- | --- |
| Name | `anam` | string (3) | Authored text | 0; 0 |
| Hero ability | `aher` | boolean encoded int (0) | 0 = ordinary unit ability | 0; 0 |
| Levels | `alev` | int (0) | Count | 0; 0 |
| Mana cost | `amcs` | int (0) | Mana points | 1; 0 |
| Targets allowed | `atar` | target-list string (3) | `ground,enemy,organic` | 1; 0 |
| Casting time | `acas` | unreal (2) | Seconds; observed periodic spacing is 1 or 2 seconds for the two values below | 1; 0 |
| Duration, normal | `adur` | unreal (2) | Seconds; no sixth-second tick was observed with duration 6 | 1; 0 |
| Duration, hero | `ahdu` | unreal (2) | Seconds; hero target behavior **unmeasured** | 1; 0 |
| Cooldown | `acdn` | unreal (2) | Seconds | 1; 0 |
| Cast range | `aran` | unreal (2) | World distance units | 1; 0 |
| Decaying damage (Data A) | `Esh1` | unreal (2) | Observed 10 life per periodic hit with value 10 and Data B/C/D zero | 1; 1 |
| Movement speed factor (Data B) | `Esh2` | unreal (2) | Dimensionless; reduction formula **unknown** | 1; 2 |
| Attack speed factor (Data C) | `Esh3` | unreal (2) | Dimensionless; reduction formula **unknown** | 1; 3 |
| Decay power (Data D) | `Esh4` | unreal (2) | Units, formula and timing **unknown** | 1; 4 |
| Initial damage (Data E) | `Esh5` | unreal (2) | Observed 40 initial life damage with value 40; mitigation **unmeasured** | 1; 5 |

The custom subject copies `hfoo`. Its authored unit fields are Name `unam`
(string 3), Hit points `uhpm` (int 0, life points), Movement speed `umvs`
(int 0, distance/second), Attacks enabled `uaen` (int 0, bit mask), and
Life regeneration `uhpr` (unreal 2, life/second). All have no level or data
column. The attacks mask and regeneration types were read privately from
`Units/UnitMetaData.slk`; the other three use Wisp's existing typed setters.
Attacks, movement and regeneration are set to zero so unrelated life changes
cannot masquerade as spell damage.

## Two configurations and observation

[`test/shadow-strike94/objects.ts`](../test/shadow-strike94/objects.ts) uses
the existing object encoder and includes FileIO. Both configurations use
one level, mana cost 0, range 1000, cooldown 0, durations 6, Data A 10,
Data B/C/D 0 and Data E 40. **Only `acas` changes:** `cast-field-1` (`A94a`)
sets it to 1; `cast-field-2` (`A94b`) sets it to 2. The names describe the
written field values without claiming their engine effects.

[`main.ts`](../test/shadow-strike94/main.ts) makes two independent caster/target
pairs, orders the actual `shadowstrike` spell, and samples target life every
1/32 game second for eight seconds. Each changed-life row records the sample,
elapsed milliseconds, damage and remaining life in units of 1/256 life.
Initial impact and subsequent tick times are bracketed by the previous and
current sample; they are not exact event times. Negative damage exposes
unexpected regeneration. The order's acceptance and final life are retained.

## Measured Classic behavior, 9 October 2026

Warcraft **3.0.0.24268**, Classic LAN pair 0, ran fixture source
`97e8c312f06ccd5c7e8063b0fcc1cf9110787cf7` from the private map
`~/.local/state/wisp/shadow-strike94/shadow-strike94.w3x`. The native game
was `2026-10-09T04-43-45-222Z`. All four reports were written at
04:44:13 UTC and retained under
`~/.local/state/wisp/shadow-strike94/native-classic-20261009/`, beside
the installed build record, client health and LAN status. Both clients
accepted both orders and produced identical rows: nine damage changes per
client, four complete reports, zero desyncs, 878/877 checksums and no new
crash reports. The clients were returned to their menus after capture.

| Configuration | Initial hit | Periodic hit samples | Periodic damage | Final life at sample 256 |
| --- | --- | --- | --- | --- |
| `cast-field-1`, `acas=1` | 40 at sample 17, impact in (500, 531.25] ms | 49, 81, 113, 145, 177 | Five hits of 10, total 50 | 910 |
| `cast-field-2`, `acas=2` | 40 at sample 17, impact in (500, 531.25] ms | 81, 145 | Two hits of 10, total 20 | 940 |

Every impact lies in `((sample - 1) / 32, sample / 32]` game seconds.
The rows' integer elapsed milliseconds are 531/1531/2531/3531/4531/5531
for the first configuration and 531/2531/4531 for the second. The first
periodic hit was observed 32 or 64 samples after initial impact; subsequent
hits have the same spacing. Thus the sampled damage spacing follows
`acas=1` or `acas=2` in these two configurations. This does not establish
exact cast-start or impact times. No tick at six seconds after impact was
observed in either configuration. Data B/C/D, hero targets, other durations
and damage mitigation remain unmeasured.

The 540-frame 32-bit Lua headless journey at the fixture source reports
`order-accepted=false`, unchanged life 1000 and no damage rows, then fails
with `Shadow Strike journey needs modeled stock spell behavior; see #94`.
**Unsupported:** `IssueTargetOrder` stock `shadowstrike` execution, initial
damage, periodic damage and scheduling. Agreement is **0/2 configurations**,
**0/9 native damage rows per client**; placeholder unchanged life is not
agreement. Ability field readback cannot stand in for these behaviors.
The native reference is now available, but the headless damage/timing part
of #94 remains unfinished.

## Reproduce the reference

From the exact fixture commit, using the owner's private base map:

```sh
bun test/shadow-strike94/build.ts \
  ~/.local/share/smashcraft-build-inputs/physics-base.w3m \
  ~/.local/state/wisp/shadow-strike94/shadow-strike94.w3x
bun wisp lan fresh ~/.local/state/wisp/shadow-strike94/shadow-strike94.w3x --pair K
```

The existing offline LAN owner chooses `K`; this fixture does not start or
stop clients. Wait for eight game seconds, then retain both configurations'
`shadow-strike94-*-p0.txt` and `shadow-strike94-*-p1.txt` FileIO outputs from
each client's CustomMapData. Record the exact executable build, fixture
commit and map path beside those private numeric observations. Confirm
accepted orders and nonempty damage rows before interpreting tick timing.

The same map bundle has a 540-frame headless journey:

```sh
bun node_modules/typescript-to-lua/dist/tstl.js -p test/shadow-strike94/tsconfig.headless.json
LUA32 build/shadow-strike94/headless/headless.lua \
  build/shadow-strike94/map.lua src/natives/warcraft.d.ts
```

`LUA32` denotes the repository's pinned 32-bit interpreter. This journey
currently reports missing stock-spell behavior, rather than fabricating
damage. After implementing the narrow behavior from native observations,
compare every damage256/life256 row and its sampling bracket for both configs
and both clients. Publish matched/total rows, first mismatch if any, exact
game build and fixture commit here; keep raw private inputs outside Git.
