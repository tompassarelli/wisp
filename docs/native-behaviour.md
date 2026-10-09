# Native weapon range

[Wisp #93](https://github.com/tompassarelli/wisp/issues/93) separates a
successful setter, its getter readback and actual attacks. The retained Classic
LAN reference below was measured on 9 October 2026. Community reports in
[#92](https://github.com/tompassarelli/wisp/issues/92) are hypotheses.

The [source-owned fixture](../test/weapon-range93/cases.ts) has twelve rows:
weapon indices 0 and 1, unchanged range 256 or a setter requesting 512, and
target distances 128, 384 and 640. Each fresh attacker has only the tested
weapon enabled. Authored object definitions disable movement, collision,
regeneration, acquisition and target attacks. Each attack order has a
two-second observation window. The changed 384 row is the old/new gap;
128 and 640 are the near/far controls. Damage means target life decreased;
order acceptance alone does not mean an attack reached the target.

## Capture after quiet time

The native session owner builds from this checkout using a private base map:

```sh
bun test/weapon-range93/build.ts "$BASE_MAP" "$PRIVATE_OUT/WeaponRange93.w3x"
bun wisp lan fresh "$PRIVATE_OUT/WeaponRange93.w3x" --pair 0
```

Use the existing offline pair after it is available; this fixture needs no
input after start. Wait for both clients' `CustomMapData/weapon-range93-p0.txt`
and `weapon-range93-p1.txt` to contain twelve rows (about 24 game seconds).
Retain those text files privately, the source commit, exact Warcraft build
from the session/build registry, and native session health. Do not infer the
build from `GetGameVersion`. An incomplete run, moved attacker, failed near
control or damage in an unchanged far control requires fixing the fixture
before judging the setter. Compare the two clients' rows.

The files record old/new getter values, setter return (`not-called` in
controls), order return, damage, life before/after and attacker movement.
Object field identifiers and value types were checked against
[WurstStdlib2 UnitObjEditing](https://github.com/wurstscript/WurstStdlib2/blob/e3714f629113ee682353c3244065fee3e7d9ae16/wurst/objediting/UnitObjEditing.wurst)
(Apache-2.0); only interface facts informed these original definitions.
No game files or assets are included. Build output stays private.

## Native table and Wisp comparison

| Reference | Exact build | Native rows | Setter/readback agreement | Attack agreement |
| --- | --- | --- | --- | --- |
| [Classic LAN pair 0, 9 October](https://github.com/tompassarelli/wisp/issues/93) | 3.0.0.24268 | 12/12 per client, identical | Setter 0/6 modeled; readback 0/12 modeled | 0/12 modeled |

The private raw rows are at
`~/.local/state/wisp/weapon-range93/native-classic-20261009/weapon-range93-p0.txt`
and `weapon-range93-p1.txt`. The native game was
`2026-10-09T04-29-04-328Z`; its action log is under
`~/.local/state/wisp/lan/pair-0/games/`. Fixture source is
`d98ebb08befdf66d37734ad13fa63717b3c37a8d`; the replay used
`34c239f16be7a0325928bc5a696c10f338bd5d4a` (including the initial-life fix
`91899a53dec43809bcce9ae1ae62ff68334263b0`). The retained build registry and
health report name both live clients, no new error reports, and zero desyncs
with 1,516 checksums from each client.

For both weapon indices, the measured table is:

| Setter request | Distance | Setter return | Getter before/after | Order accepted | Damage in two seconds |
| --- | ---: | --- | --- | --- | --- |
| None | 128 | Not called | 256 / 256 | true | 88 |
| None | 384 | Not called | 256 / 256 | false | 0 |
| None | 640 | Not called | 256 / 256 | false | 0 |
| 512 | 128 | true | 256 / 256 | true | 88 |
| 512 | 384 | true | 256 / 256 | false | 0 |
| 512 | 640 | true | 256 / 256 | false | 0 |

Every attacker remained stationary; both near controls passed and both
unchanged far controls stayed undamaged. The setter's true return did not
change the measured getter or attack reach in this fixture.

Six rows call the setter; all twelve read range and observe attacks.
Report setter return and readback separately from attacks. Do not count an
unmodeled call as agreement. Wisp currently does not model
`UNIT_WEAPON_RF_ATTACK_RANGE` through `BlzGetUnitWeaponRealField` /
`BlzSetUnitWeaponRealField` or native attack reach; the shared replay entry
[headless-lua.ts](../test/weapon-range93/headless-lua.ts) names that field
alongside missing native calls. Both Bun and Lua32 replayed twelve rows per
client without divergence. All twelve range/attack cases remain unsupported;
zero supported comparisons are available for setter return (0/6), readback
(0/12) or attack behavior (0/12). Placeholder values are not agreement.

Implement only the measured semantics when closing these headless gaps and
publish supported agreement/case counts here.
The result will cover stationary normal ground attacks, these two weapon
indices, the three distances, the two-second window and the observed build.
It will not establish behaviour for every setter, weapon type or build.
