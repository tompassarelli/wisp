# Dynamic stock and Channel reports

[Wing-Span's original Hive report, post #21](https://www.hiveworkshop.com/threads/%E2%9A%99%EF%B8%8Fhive-workshop-community-invited-to-help-improve-the-warcraft-iii-world-editor.375153/post-3744908)
requests more shop and ability controls. The Footman case below supplies one
native observation; the other assertions remain untested. Wisp's headless
model is not native evidence.

| Report | Status and scope |
| --- | --- |
| Items and units added dynamically lack hotkeys | **OBSERVED for one `AddUnitToStock` entry**: `hfoo` on 3.0.0.24268 displayed no key and F did not buy it. The broader claim and `AddItemToStock` remain **UNVERIFIED**. |
| Dynamically added stock lacks current cooldown/restock-time control | **UNVERIFIED**. Observing one entry's natural restock does not establish whether every native or object field can control it. |
| `AAns` needs cooldown and charge fields | **UNVERIFIED**. No synthetic AAns case or named-build result is claimed here. |
| Channel needs caster, target and missile effect fields | **UNVERIFIED**. No synthetic Channel case or named-build result is claimed here. |

Missing engine or editor controls are requests to Blizzard. Wisp does not
promise to add those controls or change World Editor.

## Synthetic dynamic-stock case

`test/dynamic-stock99/main.ts` follows the native reference map pattern used
by `test/table-order`: a source-owned script in a supplied private base map.
It creates an `nshp` Goblin Shipyard and an `Hpal` buyer, removes then adds `phea` item
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

## Native result: one Footman entry on 3.0.0.24268

Observed 9 October 2026 using fixture commit `03fc2a417`, Classic graphics,
the offline pair's existing hotkey configuration, and a normal-speed LAN
game. No hotkey override or restock duration was authored in the fixture.
The buyer had 10,000 gold/lumber and a food cap of 100.

Selecting the Goblin Shipyard showed the dynamically added **Train Footman**
entry, costing 135 gold and two food. Its tooltip had no parenthesized key;
the shipyard's original **Hire Transport Ship (T)** entry did display one.
The configured Footman stock was current one, maximum one. A purchase
exhausted it and displayed a countdown, rather than a readable quantity badge.

With that shipyard selected, pressing **F** produced no sale row. Clicking
the Footman entry did produce a sale. Four clicks across restocks logged
`unit-sale type=1751543663` (`hfoo`) at native timer values 208,076;
274,655; 346,858; and 429,656 ms. These are click purchases, not successful
hotkey purchases. This supports Wing-Span's missing-hotkey report for this
specific unit entry and build; it supplies no universal verdict.

The third purchase was followed by one scheduled capture sequence. The
elapsed column is the LAN host's game clock after capture, relative to the
clock immediately before the purchase input; capture and input take time.

| Requested view | Recorded elapsed | Visible Footman entry |
| --- | ---: | --- |
| Immediately | 1.32 s | Countdown 30; unavailable |
| 5 s | 5.43 s | Countdown 26; unavailable |
| 15 s | 15.41 s | Countdown still visible; unavailable |
| 30 s | 30.50 s | Normal icon returned; first observed availability |
| 60 s | 60.52 s | Normal icon remained; a subsequent click logged another sale |

This entry naturally restocked at approximately 30 game seconds. That
observation does not resolve the **UNVERIFIED** claim about controlling its
current cooldown or restock duration. Both clients stayed connected and the
host recorded zero desyncs.

The fixture also called `AddItemToStock` for `phea` (rawcode 1885889889),
but this shipyard lacks the `Asid` Sell Items ability, and the item was not
shown. No item sale occurred. That fixture omission is not an engine failure;
item entry, hotkey and cooldown claims remain **UNVERIFIED**. Channel and
`AAns` were not exercised by this case.

The private map, timed captures, stock-sale files and action log are retained
under `~/.local/state/wisp/dynamic-stock99/`; game ID
`2026-10-09T04-56-42-892Z`. The headless fixture setup or an
`IssueTargetOrder` call alone cannot replace these native UI observations.
