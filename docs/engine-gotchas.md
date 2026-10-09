# Dynamic stock and Channel reports

[Wing-Span's original Hive report, post #21](https://www.hiveworkshop.com/threads/%E2%9A%99%EF%B8%8Fhive-workshop-community-invited-to-help-improve-the-warcraft-iii-world-editor.375153/post-3744908)
requests more shop and ability controls. These are community assertions awaiting
a named Warcraft build and a synthetic native case. Wisp's headless model is
not native evidence.

| Report | Status and scope |
| --- | --- |
| Items and units added dynamically lack hotkeys | **UNVERIFIED**. Relevant natives: `AddItemToStock` and `AddUnitToStock`. No native shop observation is retained for this case yet. |
| Dynamically added stock lacks current cooldown/restock-time control | **UNVERIFIED**. Observing one entry's natural restock does not establish whether every native or object field can control it. |
| `AAns` needs cooldown and charge fields | **UNVERIFIED**. No synthetic AAns case or named-build result is claimed here. |
| Channel needs caster, target and missile effect fields | **UNVERIFIED**. No synthetic Channel case or named-build result is claimed here. |

Missing engine or editor controls are requests to Blizzard. Wisp does not
promise to add those controls or change World Editor.

## Synthetic dynamic-stock case

`test/dynamic-stock99/main.ts` follows the native reference map pattern used
by `test/table-order`: a source-owned script in a supplied private base map.
It creates an `nshp` shop and an `Hpal` buyer, removes then adds `phea` item
stock (one available, maximum one), adds `Asud` to the shop and adds `hfoo`
unit stock (one available, maximum one). It logs successful item/unit sales
and elapsed milliseconds to `CustomMapData/dynamic-stock99.txt`.
Installed stock definitions remain build-dependent; this case does not set
a hotkey or restock duration in custom object data.

Build it with `bun test/dynamic-stock99/build.ts BASE.w3m OUT.w3x`, using
the same private base-map requirements as [the native table-order case](headless.md#native-table-iteration-order).
Keep the base map, output map, game inputs and captures outside Git.

The native LAN operator must record:

1. Exact native version/build, fixture commit, graphics mode and hotkey mode.
2. Whether `phea` and `hfoo` appear as stock entries after startup, with displayed
   quantity and tooltip hotkey (including an absent hotkey explicitly).
3. Whether each advertised key actually buys its entry through the client's
   supported in-game input route; retain the sale row. If that route cannot
   exercise a purchase, report the blocked action rather than infer success.
4. After one purchase, the entry's visible cooldown immediately and at 5, 15,
   30 and 60 game seconds, and the first observed time it becomes available.
   Record “not available by 60 s” when appropriate, rather than guessing its
   restock interval. Preserve the client log and its sale times privately.
5. State whether this exact entry/build supports or contradicts the missing-hotkey
   report. Describe measured restock separately from the unverified claim about
   controlling restock. The shop case supplies no verdict on Channel/AAns.

**Native result: pending.** Stock entry, available hotkey and cooldown behaviour
have not been observed on a named native build. Do not replace this line with
a headless output or a fixture's intended setup.
