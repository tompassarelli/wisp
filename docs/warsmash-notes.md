# Warsmash behavior notes

Research dates: 7–8 October 2026. These independently written facts inform
Wisp's unit-state work (#44), matched rendered frames (#40), and standalone
player investigation (#48). They describe the public source at
[`f9e0aeed4be372d6016519d0e97b384aa873f374`](https://github.com/Retera/WarsmashModEngine/tree/f9e0aeed4be372d6016519d0e97b384aa873f374).

**Done when:** facts cite formulas, constants, event order and file formats;
native fixtures confirm behaviors needed by Wisp; the checked page appears in
the feature index and is published. **Not required:** Wisp implementation
changes, copied code, pseudocode, or a Warsmash integration.

## How to use this page

Warsmash is an independent Warcraft emulator, not a native-game measurement.
Every observation below is **source-researched** unless explicitly labeled
**native-confirmed**. Numerical differences must be decided by native
fixtures, not by assuming that another emulator is correct.

The inspected repository declares [AGPL-3.0](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/LICENSE).
Scope reused here: behavioral and file-format facts expressed in new prose,
with attribution. No source, comments, implementation layout or algorithms
are imported. Wisp implementers use this page without inspecting Warsmash
source. Incorporating that engine or deriving implementation from its code
would require a separate license decision; these notes do not authorize it.

## Life and death: facts for #44

| Observation in Warsmash | Consequence for a Wisp fixture | Primary source |
| --- | --- | --- |
| Dead means life at or below **0**, not 0.405. A direct life assignment stores the supplied float. | Native fixtures must determine the actual Warcraft threshold and clipping. Warsmash cannot validate Wisp's 0.405 assumption. | [life/dead observations](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CWidget.java#L69-L89) |
| An alive-to-dead life write dispatches death processing before it returns. A write to an already-dead unit does not repeat that transition. Raising life alone does not clear corpse bookkeeping or perform a full resurrection. | Record life and dead state both inside death callbacks and after the call; separately test positive life writes on a corpse. | [life-write behavior](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L3893-L3901) |
| KillUnit assigns zero only while alive. RemoveUnit suppresses death events by default. | Count events for first kill, repeated kill and removal separately. | [kill behavior](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L3139-L3143), [removal behavior](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L4435-L4456), [default](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/util/WarsmashConstants.java#L52) |
| Death notifications occur in this order: widget-death, unit-death, owning-player unit-death. Life is already dead, orders have ended, and food bookkeeping has been updated. Explosion removal follows these notifications. This is condition-check and action-scheduling order, not synchronous action completion. | Log conditions separately from actions for all three event kinds, including observed life and food. Replacement/reincarnation abilities need a separate fixture. | [death notifications](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L2975-L3040), [notification order](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L3116-L3129) |

Warsmash simulation steps are **0.05 seconds**, or 20 Hz. Each corpse phase
ends on the first step strictly later than its start step plus the duration
divided by 0.05, rounded down to an integer. Death animation duration comes
from unit data; flesh, bone and structure decay durations come from gameplay
data. A nonhero without decay disappears after its death phase; a hero can
remain hidden awaiting revival. These are emulator timing facts, not values
to adopt for current Warcraft. See [step constant](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/util/WarsmashConstants.java#L20),
[corpse transitions](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L1897-L1949),
and [decay data](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CGameplayConstants.java#L137-L140).

Event filters and conditions are evaluated at notification time; JASS action
callbacks are scheduled as threads. A simulation step updates units and
projectiles, advances the turn, dispatches due timers, checks tick triggers,
then runs those script threads. Thus the notification order above does not
answer whether an action completes before a life-setting native returns in
Warcraft. Measure condition and action logs independently.
[Event dispatch](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/jassparser/src/com/etheller/interpreter/ast/scope/GlobalScope.java#L693-L705),
[script action scheduling](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/jassparser/src/com/etheller/interpreter/ast/scope/trigger/Trigger.java#L128-L140),
[simulation event order](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CSimulation.java#L510-L597).

**Native-confirmed, existing Wisp evidence:** synchronized network turns in
the measured Warcraft run are 25 game-ms apart, on a 24.87–24.99 ms observed
grid. This concerns network delivery, not proof of every simulation or
animation update's frequency. [Network measurements](network-model.md#what-it-models)
take precedence over Warsmash's 50 ms choice.

## Animation clock, pose and blending: facts for #40

MDX sequence intervals and sampled frames use milliseconds. Warsmash
advances animation time by **elapsed seconds × 1000 × time scale**, retaining
fractional time but sampling at an integer millisecond. Selecting a sequence
starts at its interval start; an invalid index selects no animation. The
observed completion boundary is **interval end − 1 ms**. A normal loop
restarts at the interval start and discards overshoot; a nonlooping sequence
holds its final frame. Model flags 0 permit looping. This end/overshoot
behavior requires native comparison before Wisp relies on it.
[Clock and end behavior](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/mdx/MdxComplexInstance.java#L579-L636),
[sequence selection](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/mdx/MdxComplexInstance.java#L761-L799).

The unit's Blend Time field (`uble`, named `blend` in unit UI data) is read
from data and converted from seconds to milliseconds. The source does not
establish **0.15 seconds** as a universal default; check the consuming unit's
actual object data. [Field identity and read](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/rendersim/RenderUnitTypeData.java#L48),
[seconds conversion](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/rendersim/RenderUnit.java#L143-L144).

The source-researched blend order is:

1. When a previously played sequence changes and no earlier blend remains
   active, preserve its local translation, rotation and scale. Set the blend
   time remaining to the configured duration, and the new sequence time to
   its start. A change during an active blend does not restart that blend.
2. Advance the new animation clock and subtract the **same animation-time
   increment** from blend time remaining, before evaluating the pose.
3. For positive remaining time, let **r = remaining / duration**. Displayed
   translation and scale are **(1 − r) × new value + r × saved value**.
   Rotation uses spherical interpolation from new to saved rotation with
   weight r. When remaining time reaches zero, use the new pose alone.

At a configured duration of 150 ms, 50 ms of animation progress leaves
two-thirds of the old local pose in the blend. **Time scale zero freezes both
the animation clock and blend progress.** Direct frame seeking changes the
sample time without consuming remaining blend time. A seek by completion
ratio does consume the forward animation-time difference, including a wrap
when the ratio moves backward. These are distinct operations.
[Blend start](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/mdx/MdxComplexInstance.java#L777-L789),
[saved pose](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/SkeletalNode.java#L248-L259),
[blend weights](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/SkeletalNode.java#L82-L133),
[translation weight](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/SkeletalNode.java#L206-L214),
[seek behaviors](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/mdx/MdxComplexInstance.java#L973-L1002).

**Native question, not a conclusion:** #40 has a retained native frame whose
pose resembles a 0.3-second seek while headless observes a 0.4-second seek
with the same model bytes. Test the same sequence switch and seek at blend
zero versus the unit's existing blend setting, holding the time scale and
capture time fixed. A blend mixes poses; it is not generally equivalent to
subtracting a fixed time offset.

The inspected native registration contains no `BlzSetSpecialEffectTime` or
`BlzSetSpecialEffectTimeScale` registration. Do not infer those Warcraft APIs'
seek units, sequence-relative origin, or blend behavior from Warsmash's
internal frame seek. [Inspected native registrations](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java).

Global-sequence tracks use a separate accumulated animation-time counter
modulo their configured duration; a zero duration samples time zero.
Sequence selection preserves that counter. Translation defaults to
(0, 0, 0), rotation to quaternion (0, 0, 0, 1), and scale to (1, 1, 1) when
the selected animation has no applicable keys.
[Global clocks and defaults](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/mdx/Sd.java#L80-L131).

For quaternion interpolation, let **L** and **R** be the left and right key
rotations, **O** the left outgoing tangent, and **I** the right incoming
tangent. Warsmash uses the same spherical cubic formula for Hermite (2) and
Bezier (3):

**Q(t) = slerp(slerp(L, R, t), slerp(O, I, t), 2t(1 − t)).**

When O = L and I = R, this reduces to ordinary slerp between the endpoints;
at t = 0.5 it gives their spherical midpoint. This agrees with the
`war3-model` behavior reported by the #40 worker, so this fact does not
explain that worker's apparent 0.4/0.3-second pose difference. Warsmash slerp
uses the shorter quaternion arc by changing the right quaternion's sign
when the dot product is negative. It uses linear weights when
**1 − dot ≤ 0.000001**, and spherical sine weights otherwise. The inspected
quaternion and track-sampling paths have no model-version or 1800-specific
interpolation branch; this does not establish overall version-1800 model
support or native Warcraft's interpolation.
[Endpoint/tangent identities](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/mdx/QuaternionSd.java#L24-L31),
[Hermite/Bezier behavior](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/util/Interpolator.java#L54-L69),
[spherical formulas](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/util/RenderMathUtils.java#L405-L454).

## Map-reliance observations for #50

This section uses the original **f9e0aeed4be372d6016519d0e97b384aa873f374**
revision and AGPL-3.0 license identified above. Every finding is
**source-researched**, including behaviors that differ from the map's
requirements. It supplies no additional native confirmations. The map
inventory supplied by #50 uses direct body/effect positioning and timers;
engine movement orders, queued unit animations and attachment natives are
outside that inventory.

### Smashcraft use and current Wisp verdicts

The consumer inventory is Smashcraft **992ec9d3**: 179 distinct native names
in authored `ts/src/` excluding `*.tests.ts`, including optional diagnostic
entries. Wisp's imported FileIO, reload and scene code adds the file, sync and
effect getter operations described below. The runtime comparison is Wisp
**211b899**, its `src/headless/client.ts`, frame implementation, and
Smashcraft's `scripts/wisp/headlessNatives.ts` declarations. A source match
means the stated operation agrees with the researched behavior; it is not a
Warcraft 3.0.1 confirmation. An unavailable Warsmash native cannot establish
either a native match or a native mismatch.

| Relied-on behavior and consumer | Warsmash rule from this page | Current Wisp behavior | Verdict and deciding measurement |
| --- | --- | --- | --- |
| `CreateTimer`, `TimerStart`, `GetExpiredTimer`, `DestroyTimer`: zero-time shell initialization, 60 Hz simulation, hot reload, trace and diagnostic clocks | 50 ms steps; deadline truncates to a step; timer context belongs to the queued callback | 60 Hz frames with deadlines kept to 1/61,440 s; sub-frame periods catch up inside a frame | **Mismatch with Warsmash's clock**, deliberately; see [Timers and frame stepping](#timers-and-frame-stepping) for each rule. |
| Equal-deadline callbacks and callbacks scheduling other timers | Registration order, callback threads after due-timer notification | Deadline order, then `TimerStart` order; timers started inside a callback wait until the next frame | Changed by wisp#56; see [Timers and frame stepping](#timers-and-frame-stepping). |
| `TimerGetElapsed`, `PauseTimer`: trace periods, timeout reads, optional smooth drawing | Elapsed capped at timeout, repeating timer rescheduled; paused elapsed still uses its advancing clock | Elapsed restarts each period; expired reads the timeout; paused stays frozen | Changed by wisp#56; see [Timers and frame stepping](#timers-and-frame-stepping). |
| `SetUnitX/Y`, `SetUnitFlyHeight(..., 0)`, `BlzSetUnitFacingEx`: fighter body placement each draw | Direct coordinate/height writes; immediate facing; normal body rendering can lag position | Immediate stored position, height and facing in snapshots | **Match for direct state writes and 0/180-degree facing**; rendered position lag remains unmeasured for the paused Locust bodies. #40's same-frame body capture decides the visible contract. |
| `CreateUnit`, `RemoveUnit`, type/handle/owner, `ShowUnit`, scale, vertex color, move speed and attack cooldown: bodies and object-data readback | Object/state facts, separate visibility and rendering, with the life caveats above | Retained unit fields and snapshots; type becomes zero on removal | **Partial source match**. #44/#45's existing native fixture owns state/object-data confirmation. Life/death thresholds are outside Smashcraft's scripted fighting damage. |
| `SetUnitPathing(false)`, `PauseUnit(true)`, Locust and Crow Form, invulnerability: disable ordinary engine interaction | Direct writes do not reject a paused unit; missing `SetUnitPathing` registration gives no disabled-pathing rule | Consumer explicitly ignores these flags because all fighting motion and damage are scripted | **Match for absence of engine movement in the headless journey**; native paused-body placement still requires #40. Engine collision/pathfinding is not called by this map. |
| `SetUnitAnimation/ByIndex`, `SetUnitTimeScale`, `SetUnitBlendTime`: fallback bodies | Sequence clocks advance by elapsed time × speed; blend uses saved old pose and current pose | Stores selection, resets animation elapsed, advances at 60 Hz; consumer ignores unit blend time | Changed by wisp#58; see [Animation playback](#animation-playback). |
| `BlzSetSpecialEffectAnimation`, `BlzPlaySpecialEffect`, `BlzSetSpecialEffectTime/TimeScale/AnimationBlendTime`: fighter/effect playback | These modern native contracts are absent; internal model clock/blend rules are recorded above | Selected clip and seek time retained; blend-time call is an explicit consumer no-op; renderer samples model tracks | Changed by wisp#58; see [Animation playback](#animation-playback). The seek's native contract stays unresolved. |
| Effect attachment: dizzy marks, weapons, projectiles, summons, aura and hit effects | Target attachments can follow animated model transforms; modern positioning native is absent | Map places every effect itself with `BlzSetSpecialEffectPosition`, axis setters and yaw/pitch/roll; Wisp retains the requested transforms | **Match for the map's manual attachment contract**. No `AddSpecialEffectTarget` call or skeletal attachment dependency exists in the inventory. #40 compares the resulting positions. |
| Effect create/destroy, model/alpha/color/team color, scale and matrix scale | Point effect begins at surface/terrain height; other modern setters absent | Starts at Z=0 until explicitly placed; immediate removal; transforms and colors retained, model rendering supplies mesh/particles | **Native verdict unresolved** for create/destroy tails and model rendering. Scripted effects normally set their world Z before drawing; #40 and #48 own the visible checks. |
| `CreateSound/FromLabel`, `StartSound`: hit, summon, selection and match cues | Creation loads; start requests playback during the call | Creation and each start produce separate frame-tagged cues | **Match for request order**. A create alone is not a start. Audible onset needs the same native capture; cue-log equality does not measure speaker timing. |
| Sound position, pitch, volume, duration, stop and `KillSoundWhenDone` | Setters are missing or no-ops in the researched revision | Position/pitch/volume retained at start; completion/attenuation ignored by consumer; stop and lifetime are not represented in the cue log | See [Sound start, stop and channel limits](#sound-start-stop-and-channel-limits) (wisp#60) for each rule. #48 owns audible playback; #51 owns the 3.0.1 OGG playback capture. |
| Music play/stop/theme and file duration: round, victory and stage music | Request forwarding only | Consumer ignores background playback and decoding; explicit sound starts are retained | **Mismatch in observable audio coverage**; soundtrack playback is not represented by the headless cue report. |
| Engine order queues and `QueueUnitAnimation` | Queued orders begin in insertion order; immediate orders cancel or replace pending orders | No movement/order/animation-queue model | **Not used**: no engine order or queue native appears in Smashcraft's source. Fighter input buffers are map simulation data, already replayed by the checksum check. |
| Sync send/delivery and trigger callbacks: journal rows, frame UI, chat and key events | Due timers precede tick triggers and script threads; no current Battle.net latency measurements | Ordered triggers; configured sync delivery uses native-measured 25 ms turns and 60 Hz callbacks | **Intentional mismatch with emulator timing**; [network model](network-model.md) records the native basis. Three 3.0.1 online pad runs must match saved checksums. |
| UI creation/destruction, named frame lookup, parent/child visibility, size/anchors/text/texture, level, focus, enable and text limit | No researched current `BlzFrame*` native contract in this page | Retained frame tree, layout, text input and events; font rasterization/alignment/scale are consumer no-ops | **Native verdict unresolved** for pixels; existing frame-state tests cover the Wisp contract and #40 covers matched UI captures. |
| Local keyboard/mouse/focus/window dimensions and player slot/controller/name | No current client-input rule researched here | Scripted key state and frame typing; fixed client dimensions; consumer returns no mouse input and a configured slot roster | **Mismatch with a physical client**, an intentional input source substitution. Pad runs use the actual helper and compare its delivered frames; they do not validate physical mouse input. |
| Camera position/field/bounds/smoothing/pan: stage framing and zoom | No native camera-interpolation contract researched here | Camera fields and target retained immediately; bounds/smoothing ignored, pan maps to direct position | **Mismatch in interpolation coverage**; #40's captured camera values and pixels decide visible differences. |
| Terrain/sky/fog/day-night, lightning and text tags: stage scene and feedback | No matching current native contract researched here | Scenery/fog globals are ignored by the consumer; core scene snapshots record units, effects, frames and cues rather than every engine primitive | **Mismatch in scene coverage**. These calls are not evidence that terrain, lightning or text-tag pixels match; #40/#48 are the existing scene owners. |
| Numeric/string conversions, IDs and handles; FileIO/preload; map-origin locations; diagnostics and restart | Warsmash is not a current Lua/binary32 or Preloader-cache oracle | Shared 32-bit numeric rules, native-style conversions, per-client handle IDs; first-read Preloader cache; authored origin (0,0,0); diagnostic messages and file outputs retained | **Match to Wisp's existing native-derived contracts**, separately documented in [headless](headless.md) and [hot reload](hot-reload.md). Restart is an external session action, not a simulation behavior. |

The timer capture entry is `test/native-rules50/main.ts`. It writes eleven
ordered readings to `native-rules50-pSLOT.txt` after 1.25 game seconds, using
0.5-second timers and 0.75/1.25-second observations. Both Bun and the native
map execute this same authored fixture. In particular, it measures the
disagreement before changing periodic clocks or same-deadline order.
wisp#56 changed those headless readings; `test/timers56/` now carries the
timer rules (see [Timers and frame stepping](#timers-and-frame-stepping)).
Its `start()` first writes the unchanged twelve unit-state cases, so one
private game can supply #44 and #50 observations together. Build with
`bun test/native-rules50/build.ts BASE.w3m PRIVATE_OUT.w3x`; both output
files must be collected from each client. The earlier #44 fixture stays
available for comparison.

The replay surface at Smashcraft 992ec9d3 is **413 runnable `.pad` files**:
54 at the root, 160 under `180/`, and 199 across the other 24 folders.
Every script names a match and exports a View-held moment. The JSON file
under `233/` configures a helper interruption and is not a pad script.
The headless result now parses and replays every exported moment, compares
the recorded intermediate and final checksums, and refuses missing or
malformed exports. This is separate from native-to-headless comparison of
the three unchanged online spot-check scripts.

### Timer deadlines and callback order

For a nonnegative timeout **T**, the emulator schedules a deadline at the
start turn plus **trunc(T / 0.05)** turns. Registration takes effect at the
next timer-processing phase. A zero timeout or positive timeout below
50 ms can therefore fire on the next simulation step; a repeating timer
in that range fires at most once per step, not at 60 Hz. Elapsed time is
**min(T, elapsed turns × 0.05)**. These emulator values cannot resolve
Smashcraft's 60 Hz shell, faster drawing timer, or native substep timing.
[Timer clock](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/timers/CTimer.java#L33-L77),
[registration and due timers](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CSimulation.java#L568-L597).

Equal-deadline timers are notified in registration order. A timer's JASS
handler is queued before its registered timer-event notifications; script
threads run after the due-timer and tick-trigger phases. Newly queued
non-sleeping handlers run in their queue order. A callback that sleeps does
not promise completion before the next callback. `GetExpiredTimer` reads
the timer carried by that callback's execution context.
[Equal deadlines](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CSimulation.java#L272-L285),
[handler and timer events](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/timers/CTimerJass.java#L44-L70),
[thread execution](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/jassparser/src/com/etheller/interpreter/ast/scope/GlobalScope.java#L577-L588),
[non-sleeping execution](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/jassparser/src/com/etheller/interpreter/ast/scope/GlobalScope.java#L636-L660),
[expired context](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L5523-L5533).

`TimerStart` ignores an already-running timer. A repeating timer is
rescheduled before its queued JASS callback executes, so restarting it
inside that callback is also ignored. A one-shot callback can restart its
timer, with that registration considered on the following step.
Pause/destroy requests remove a timer during the next timer-processing
phase, after additions are considered; they do not cancel a callback that
was already queued. Pausing stores the remaining duration, but the inspected
elapsed-time getter still uses the advancing turn counter. Consequently
restart and paused elapsed-time semantics need native evidence rather than
adopting these emulator behaviors.
[Start/pause/destroy natives](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L815-L874),
[repeat rescheduling](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/timers/CTimer.java#L89-L102).

### Direct unit position, facing and pathing

`SetUnitX` and `SetUnitY` immediately store the requested binary32 coordinate,
translate collision bookkeeping and check region membership. They do not
search for a pathable alternative. Separate X/Y calls expose the intermediate
position to region checks. `SetUnitPosition` instead performs an unstuck
placement check, so it is not evidence for the map's manual movement.
[Coordinate natives](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L3068-L3108),
[position and region observations](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L2676-L2756).

Simulation facing is normalized into **[0, 360)** degrees.
`BlzSetUnitFacingEx` changes both simulation and displayed facing;
`SetUnitFacing` changes simulation facing alone, with the renderer turning
toward it on later updates. `SetUnitFlyHeight` assigns height directly and
ignores the rate argument in this revision. `PauseUnit` sets a unit flag;
the direct coordinate/facing writes above have no paused-unit rejection.
[Facing normalization](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L1840-L1844),
[normal facing/height natives](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L3110-L3141),
[immediate facing native](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L4565-L4573),
[pause native](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L4211-L4218).

Ordinary displayed unit positions can lag simulation positions: the renderer
moves by at most **move speed × elapsed seconds** toward the stored position
when the gap exceeds that distance and elapsed time is below one second.
Otherwise it displays the stored position. This is a renderer observation,
not a native measured delay. The inspected registrations contain no
`SetUnitPathing`; behavior with pathing disabled, Locust or Crow Form cannot
be established from that missing native or from direct X/Y writes alone.
[Displayed position](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/rendersim/RenderUnit.java#L205-L223),
[inspected registrations](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java).

### Unit position and facing

Owner: wisp#57. Smashcraft **main** (`ts/src/`, excluding tests) moves units
only in `platform/shell/fighterBody.ts`: each draw calls `SetUnitX`,
`SetUnitY`, `SetUnitFlyHeight(..., 0)` and `BlzSetUnitFacingEx` with 0 or
180 on a body created with pathing off, Crow Form added and removed, Locust
and `PauseUnit`. It never reads a unit's position, height or facing back, and
calls no `SetUnitPosition`, `SetUnitFacing`, `SetUnitFacingTimed`, nonzero fly
rate, order or region native. Rules for those calls are recorded only where
they explain a verdict. Fixture: `test/unit-motion57/` (five cases, Bun and
32-bit Lua in `test/headless-unit-motion.test.ts`, native map via its
`build.ts`).

| Behavior Smashcraft relies on | Warsmash rule | Wisp before #57 | Verdict |
| --- | --- | --- | --- |
| `SetUnitX`/`SetUnitY` value | Argument narrowed to binary32 and stored | Stored the argument unrounded; Bun kept doubles that Lua32 rounds | **Mismatch, fixed**: stored as binary32 |
| Read after a position write in the same callback | The setter writes the field the getter reads; no deferral | Immediate | **Match**; fixture case `position-read-in-same-call` |
| Orders on a position write | `setX`/`setY` touch only coordinates, collision bookkeeping and region events, never the order queue | No orders | **Match**; Smashcraft's bodies are paused and never ordered |
| Pathing or collision side effects | No pathability search or push for X/Y writes; collision entry is translated by the delta. Only `SetUnitPosition` runs an unstuck search | No collision | **Match** for X/Y; case `overlapping-bodies-held` reads two overlapping bodies 0.25 s later unmoved. Region events: no region in Smashcraft |
| `SetUnitFlyHeight(u, h, 0)` | Height narrowed to binary32 and assigned; rate ignored in this revision | Stored unrounded, rate ignored | **Mismatch, fixed**: stored as binary32. A nonzero rate (real game interpolates) is unused |
| `BlzSetUnitFacingEx` | Sets simulation and rendered facing at once, normalized as `((f mod 360) + 360) mod 360` in binary32 | Stored the argument unchanged | **Mismatch, fixed**: binary32 floor-modulo into [0, 360). Smashcraft's 0 and 180 were already equal; `facing-ex-normalized` covers -90, 450, 360, 720.5, -720 |
| `SetUnitFacing` turn-rate interpolation | Sets simulation facing immediately; only the renderer turns at the turn rate | Immediate | **Not relied on**: Smashcraft uses `BlzSetUnitFacingEx`. Wisp's `SetUnitFacing` shares the normalization |
| Displayed body position | Renderer closes a gap larger than move speed × elapsed seconds by at most that distance per update | Snapshots show the stored position | **Unresolved, renderer only**: snapshot state matches the simulation. Smashcraft bodies (move speed 270) dash faster than that, so the capture below decides whether the real game lags |

Warsmash's `(x + 360) mod 360` step re-rounds positive facings (0.1 reads
back as about 0.1000061). Wisp keeps an in-range binary32 facing unchanged;
Smashcraft's 0 and 180 read the same under either rule.
[Position natives](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L3068-L3108),
[facing, move speed and height natives](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L3110-L3141),
[immediate facing native](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L4565-L4573),
[facing normalization](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L1840-L1844),
[height and coordinate setters](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L2633-L2690).

**Capture needed** (wisp#57's third box, batched with #56/#58): build
`bun test/unit-motion57/build.ts BASE.w3m OUT.w3x`, play it once on 3.0.1 with
two clients, collect `unit-motion-p0.txt` and `unit-motion-p1.txt`, and
compare them with `EXPECTED` in `test/headless-unit-motion.test.ts`. In the
same session, record one Smashcraft dash at native speed and compare the body's
drawn position with its set position on the same frame.

### Effects: attachment, scale and lifetime

Owner: wisp#59. Smashcraft **main** at db050997 (`ts/src/`, excluding tests)
calls `AddSpecialEffect` (55 sites), `DestroyEffect` (32) and these setters:
`Scale` (40), `TimeScale` (35), `Time` (32), `Position` (29), `Alpha` (27),
`Animation` (23), `Color` (18), `Yaw` (17), `AnimationBlendTime` (14),
`Pitch` (9), `Roll` (5), `MatrixScale` (5), `ColorByPlayer` (4), `Z` (2),
`X`/`Y` (1 each), and `BlzPlaySpecialEffect` (2). It calls no
`AddSpecialEffectTarget`, `AddSpecialEffectLoc`, `BlzRemoveEffect`,
`BlzResetSpecialEffectMatrix` or orientation getter; attachment points are
not used, because every effect is placed by hand each frame. It reads effect
positions back only through Wisp's scene report (`BlzGetLocalSpecialEffectX/Y/Z`).
Hidden effects are collapsed with scale 0 and parked below the floor
(`game/render/effects.ts`, `hideEffect`); the victory pose is scaled to 0
before `DestroyEffect`, and the fighter light is switched off before it,
because teardown can be deferred. Animation selection, seek and blending on
effects belong to wisp#58 and are not repeated here. Fixture:
`test/effects59/` (seven cases and a Death timeline, Bun and 32-bit Lua in
`test/headless-effects.test.ts`, native map via its `build.ts`).

| Behavior Smashcraft relies on | Warsmash rule | Wisp before #59 | Verdict |
| --- | --- | --- | --- |
| `AddSpecialEffect` start point | X and Y narrowed to binary32; Z is the higher of walkable surface and ground height; yaw 0 | X and Y stored unrounded; Z 0 (headless has flat ground at 0); yaw 0 | **Mismatch, fixed**: X and Y stored as binary32. Z and yaw **match** on headless's flat ground; case `created-at-point` |
| `BlzSetSpecialEffectPosition`/`X`/`Y`/`Z` and read-back | Not registered in this revision; every effect real is a binary32 `real` argument | Stored unrounded; Bun kept doubles that Lua32 rounds; read back at once | **Mismatch, fixed**: stored as binary32. Axis setters change only their axis (case `axis-setters-independent`); reads in the same callback see the write (`position-read-in-same-call`) |
| `BlzSetSpecialEffectScale(e, 0)` and parking below the floor (`hideEffect`) | Not registered; no rule | Scale 0 kept; position kept wherever written | **Match** for the script-visible part: case `scale-zero-parked` reads the parked Z. Whether scale 0 also stops particles is visual and stays with the capture |
| Scale, matrix scale, yaw/pitch/roll, time scale, time and blend time values | Not registered; binary32 `real` arguments | Stored unrounded | **Mismatch, fixed**: all stored as binary32; `MatrixScale` multiplies the current matrix scale and rounds each product. None of them move the effect (case `scale-orientation-time-keep-position`) |
| `BlzSetSpecialEffectMatrixScale` compounding | Not registered, nor is `BlzResetSpecialEffectMatrix`; no rule | Each call multiplies the current matrix scale until `BlzResetSpecialEffectMatrix` | **Unresolved, no getter and no Warsmash rule**: Smashcraft sets it once per new deck, but `-dev backdrop on` (`showBackdrop`) reapplies it to existing scenery, which compounds if the real game multiplies. The capture's backdrop toggle decides |
| Position held between frames, frozen (time scale 0) or playing | Effects are placed once; only attached effects follow a parent | Position changes only through setters | **Match**: case `held-after-quarter-second` reads both 0.25 s later unmoved |
| `DestroyEffect` lifetime | The drawn instance stops looping, plays the model's Death sequence, then is removed; without one it is removed when its current sequence ends. Warsmash's engine-side removals (buffs, missiles) start Death at once; its `DestroyEffect` native first lets the current loop finish | Removed from the scene at once; later setters and reads on the handle do nothing | **Mismatch, fixed; now matches**: setters on the handle do nothing at once, while position reads return where the dying effect stands until it is gone (3.0.1 read (-200, 0, 0) for the frozen one; case `destroyed-frozen-reads`). The drawn effect switches to its Death sequence at once, at its last time scale, and is gone on that sequence's last millisecond; without a Death sequence it is gone at once. Lengths come from the model files the renderer loads (`effectDeaths`). Test: the Death timeline in Bun and Lua32 (gone at frame 120 for a 2 s Death). Whether 3.0.1 also finishes the current loop first is the capture's playing effect at (200, 0) |
| `DestroyEffect` on an effect frozen at time scale 0 | An instance advances `dt × 1000 × speed` ms a frame and ends a non-looping sequence only when it reaches the sequence's last millisecond; destroying doesn't change the speed, so a frozen effect never ends and is never removed | Removed from the scene at once | **Mismatch, fixed; now matches**: the frozen effect stays drawn on Death's first frame for good (timeline frame 600). Smashcraft hides its victory pose and light before destroying them, so a frozen leftover is invisible. Capture: the frozen effect at (-200, 0) |
| `AddSpecialEffectTarget` attachment | Picks the shortest attachment name containing every requested token, `origin` when empty; falls back to the unit's position | Placed at the unit's X/Y, no attachment | **Not relied on**: no Smashcraft call |

Wisp still creates point effects at Z 0 because headless has no terrain; a
map that reads a fresh effect's Z on a non-flat map would see the real
ground height natively.
[Effect natives](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L4415-L4439),
[destroy](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L4573-L4580),
[point and attachment placement](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/War3MapViewer.java#L2104-L2203),
[effect lifetime](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/rendersim/RenderSpellEffect.java),
[sequence end and speed](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/mdx/MdxComplexInstance.java#L580-L637).

**Native capture, 8 Oct 2026** (3.0.1.24342, two signed-in clients, Smashcraft's
base map): both clients wrote the seven rows; six matched and
`destroyed-frozen-reads` read `-25600,0,0`, so reads of a destroyed effect
still playing Death return its position, now `EXPECTED`. The two
FaerieFireTarget effects were not visible: the base map's black mask covers
(±200, 0) for the players, so their Death timing stays unmeasured.

The capture: build
`bun test/effects59/build.ts BASE.w3m OUT.w3x`, play it once on 3.0.1 with
two clients, collect `effects-p0.txt` and `effects-p1.txt`, and compare them
with `EXPECTED` in `test/headless-effects.test.ts` (`created-at-point`'s Z is
the base map's ground height at (100.25, -50.5), not 0, on a non-flat map).
While the map runs, watch FaerieFireTarget at (-200, 0), destroyed frozen at
time scale 0 (expected: stays, frozen), and at (200, 0), destroyed while
playing (expected: Death plays about 2 s, then gone; note whether its stand
loop finishes first). In the same Smashcraft session: end one match and
record whether any effect stays visible after teardown, and toggle `-dev backdrop off` then `on` and
compare the deck and scenery widths before and after.

### Effect placement and unavailable effect setters

A point effect starts at its requested XY and at the higher of walkable
surface height and terrain height. A target effect with a matching unit
attachment follows that attachment's animated transform. A missing
attachment falls back to the unit's displayed location at creation; item
and destructable targets are explicitly unsupported. This does not answer
the map's manually positioned effect behavior: the inspected registrations
contain none of `BlzSetSpecialEffectPosition`, `BlzSetSpecialEffectAnimation`,
`BlzSetSpecialEffectAnimationBlendTime`, `BlzSetSpecialEffectTime` or
`BlzSetSpecialEffectTimeScale`. The animation-clock section describes model
internals only; it supplies no native contract for those calls.
[Attachment and point placement](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/War3MapViewer.java#L2104-L2203),
[inspected effect registrations](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L4415-L4439).

### Sound start and unavailable sound controls

`CreateSound` loads the file into a sound handle; `StartSound` asks its audio
backend to play during that call. This establishes request order, not
speaker onset timing. Filename sounds record start against wall-clock
milliseconds; their predicted remaining duration is decoded duration minus
elapsed wall time, clipped to zero. Label sounds select through their sound
label and request playback at (0, 0, 0). The map's `SetSoundDuration`,
`SetSoundPitch` and `SetSoundVolume` are registered but do nothing in this
revision. No inspected registration exists for `SetSoundPosition`,
`StopSound`, `KillSoundWhenDone` or `GetSoundFileDuration`. Those omissions
cannot validate the map's cue positions, gain, pitch, stop or lifetime.
[Creation and setters](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L4012-L4051),
[start native](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L2337-L2345),
[filename playback and duration](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/sound/CSoundFilename.java#L46-L83),
[label playback](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/sound/CSoundFromLabel.java#L31-L50),
[no-op sound setters](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L4153-L4174).

Music play, stop and resume natives forward requests to the displayed game's
music controls. Their registrations establish call order, not audible onset,
fade completion or a simulation-step deadline.
[Music requests](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L2346-L2385).

### Order queues outside the map's relied-on behavior

The emulator ordinarily appends queued orders while a unit is executing an
order, and starts them in insertion order. An immediate interrupting order
cancels pending orders; an immediate order during an uninterruptible
behavior replaces pending orders while that behavior continues. Dead units
reject orders. Ability-specific and patrol exceptions exist. These facts
describe engine orders, which #50's map inventory does not use; they do not
expand the required parity surface.
[Order acceptance and cancellation](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L2436-L2511),
[next queued order](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L3783-L3793).

### Animation playback

Owner: wisp#58. Smashcraft **main** (`ts/src/`, excluding tests) draws each
fighter from a pool of one-sequence clip models (`game/render/fighterPool.ts`):
blend time 0, sequence `Stand`, time scale 0, and a `BlzSetSpecialEffectTime`
seek every draw; the map crossfades clips itself by showing two effects. Other
effects select named sequences (`Stand`, `stand hit`, victory, impact and cue
names), seek, and toggle time scale between 0 and 1 for pauses and hitlag.
Fallback bodies (`platform/shell/view.ts`) call `SetUnitAnimation(ByIndex)`,
then `SetUnitTimeScale`, after `SetUnitBlendTime` from object data. It calls
no `QueueUnitAnimation`, `BlzQueueSpecialEffectAnimation` or rarity control.
Rules live in wisp:src/headless/animation.ts, used by the headless runtime and
the renderer; wisp:src/headless/animation.tests.ts holds one test per rule,
run in Bun (`test/animation.test.ts`) and 32-bit Lua (`test/runtime.test.ts`).

| Behavior Smashcraft relies on | Warsmash rule | Wisp before #58 | Verdict |
| --- | --- | --- | --- |
| Selecting by name | A name's leading words that are animation tags give one primary tag and a set of secondary tags; the first other word ends it (`Stand - 2` is stand). The sequence needs the primary tag and exactly that secondary set; failing that, the set sharing most requested tags; failing that, the primary tag's sequence with fewest tags (stand when the name has none). Effect sub-animations add tags | First sequence whose name contained every word, so `stand` could pick `Stand Hit` | **Mismatch, fixed** |
| Equal variants | Drawn at random, weighted by rarity, on each client | First variant | **Unmatchable**: native picks differ per client. Wisp takes the first of the most common. Pool clip models have one sequence |
| Selecting by index | An index outside the model selects no sequence; tracks take their defaults (identity pose) | Clamped to the last or first sequence | **Mismatch, fixed** |
| Clock start on selection | Interval start; selecting again restarts | Restart | **Match** |
| Time scale | Animation time advances by elapsed seconds × 1000 × scale; 0 freezes the clock, global sequences and blend | Clock matched; blend and global clock not modeled | **Match for the clock; the rest fixed** (rows below) |
| Time scale across a selection | `SetUnitAnimation(ByIndex)` resets the speed to 1 | Keeps the set time scale | **Warsmash differs; no change**: Smashcraft sets the time scale after every selection, so both give the same result. The capture checks persistence |
| Seek (`BlzSetSpecialEffectTime`) | No such native; the internal frame seek moves the sample time and spends no blend time | Set the elapsed time | **Match to the internal rule**; native seek units stay unresolved |
| Sampled frame | Whole milliseconds; fractions kept in the clock | Fractional frame | **Mismatch, fixed** |
| End of a looping sequence | On reaching interval end − 1 ms, restart at the start, dropping the overshoot | Wrapped modulo the interval length | **Mismatch, fixed**: the renderer replays the 60 Hz steps since the last selection or seek. A seek at or past the end shows the start |
| End of a non-looping sequence | Hold at interval end − 1 ms | Held at the interval end | **Mismatch, fixed** |
| Effect with no selection | Plays Birth once, then Stand, which always loops; a unit shows Stand | Stand from creation | **Mismatch, fixed** |
| Blend (`SetUnitBlendTime`, `BlzSetSpecialEffectAnimationBlendTime`) | On a selection with blend time > 0, after the instance has animated at least 1 ms, and with no blend running: save each node's local translation, rotation and scale. Each step spends the same animation time from the blend; the shown pose is new × (1 − r) + saved × r, rotation by shortest-arc slerp, r = remaining ÷ blend time. A selection during a blend leaves it running | Not modeled; `SetUnitBlendTime` was a consumer no-op | **Mismatch, fixed** in runtime and renderer. Wisp's unit blend time starts at 0 until set (Warcraft reads `uble`); effects start at 0. Smashcraft's pool sets 0, so its fighters are unchanged |
| Global sequences | Whole milliseconds of animation time since creation, modulo the length (0 for length 0); kept across selections; seeks do not move it | Advanced to the seek time only for models with emitters, else 0 | **Mismatch, fixed** |
| Shown sequence | The selected index | war3-model's `setFrame` re-picked the first sequence whose interval held the frame | **Mismatch, fixed**: the renderer sets the frame on the selected sequence |
| Queued animations | Played in order when a non-looping sequence ends | Recorded, never played | **Not used** by Smashcraft |

Track sampling between keys is outside this family: Warsmash interpolates
from the last key back to the first across the sequence when a frame lies
outside a sequence's keys, war3-model holds the nearest key. Smashcraft's clip
models carry keys at both interval ends, so their poses do not depend on it.

**Blademaster frame 262 is not explained by these rules.** Clip 48
(victimThrowBack, interval 80435–81435, non-looping) and clip 49 are
one-sequence models with keys at 0, 300, 500, 600 and 1000 ms and no emitters.
Both clients seek them to 0.4 s with time scale 0 and blend 0, and no
sequence switch happens on either effect. Every rule above gives frame 80835
before and after this change, and a re-render with the fixes still shows the
upright headless pose.
Their global-sequence tracks move only the whirlwind and glow helpers (about
18% of vertex bone references), held at time 0 by both Warsmash's rule and Wisp. The
Blademaster is not among 3.0.1's reanimated models. What remains is the
native seek itself: whether a frozen effect hidden and shown again re-poses on
`BlzSetSpecialEffectTime`, and in what units.

Capture needed (wisp#58's third box, one private 3.0.1 game, fixed camera and
graphics mode):

1. A model listing `Stand Hit` before `Stand`: `SetUnitAnimation("stand")`
   shows Stand; `"stand hit"` shows Stand Hit.
2. A looping 1000 ms sequence at time scale 1 captured after 5.0 s, and a
   non-looping one held 2 s past its end: frame positions decide overshoot
   and the end − 1 ms hold.
3. `AddSpecialEffect` with no animation call, captured during and after
   Birth.
4. A unit with `SetUnitBlendTime` 0.15 and 0, switching sequence, captured
   50 ms later; plus time scale 0 during a blend, and `SetUnitTimeScale`
   followed by `SetUnitAnimation`.
5. A global-sequence helper under time scale 0, and a frozen out-of-range
   `SetUnitAnimationByIndex`.
6. Blademaster clip 48 and 49 at 0.4 s, time scale 0, shown after being
   hidden, with and without a second seek one frame later: the frame 262
   repeat.

### Collision, pathing and orders

Owner: wisp#61. Smashcraft relies on very little here. Its **main**
(`ts/src/`, excluding tests) issues no orders, enumerates no groups, never
asks for a range or collision size, and calls no `SetUnitPosition`. The whole
surface is the fighter body setup in `platform/shell/fighterBody.ts`
(`SetUnitPathing(false)`, Crow Form added and removed, Locust, `PauseUnit`)
and `SetUnitMoveSpeed(270)` in `platform/objectData.ts`, read back once by a
diagnostic row. The bodies derive from `earc` (a ground unit); object data
sets only move speed (`umvs`) among the movement fields. #57's notes above
already settle that position writes cause no pathing push and leave orders
alone. Fixture: `test/unit-movement61/` (two cases, Bun and 32-bit Lua in
`test/headless-unit-movement.test.ts`, native map via its `build.ts`).

| Behavior Smashcraft relies on | Real rule | Wisp before #61 | Verdict |
| --- | --- | --- | --- |
| Crow Form added and removed so `SetUnitFlyHeight` works on a ground body | Map practice says a ground unit ignores fly height writes until Crow Form (`Amrf`) or Storm Crow Form (`Arav`) has been added; Warsmash assigns height unconditionally. On 3.0.1 (8 Oct 2026, two clients) a footman set up as a fighter body (pathing off, Locust, paused) took a 300 height write without Crow Form: both bodies read 300 | Applied every height write | **Match**: every height write applies, as before #61. The native capture overturned the Crow Form gate briefly added for #61. Smashcraft still adds Crow Form, which costs nothing. Case `fly-height-needs-crow-form=38400,38400` |
| `SetUnitMoveSpeed(u, 270)` then `GetUnitMoveSpeed` | Speed is a real; Warsmash narrows it to an integer, the real game stores it as a real clamped to the gameplay constants' range | Stored the argument unrounded, so Bun kept doubles that Lua32 rounds | **Mismatch, fixed**: stored as binary32. 270 is integral and in range under every rule, so Smashcraft's reading is unchanged; clamping and integer narrowing stay unmodeled. Case `move-speed-set-and-read` |
| `SetUnitPathing(false)`: bodies never pushed or pushing | Turns off the unit's pathing and collision with other units; position writes do no pathability search anyway | No pathing or collision at all | **Match**; #57's `overlapping-bodies-held` reads two overlapping bodies unmoved |
| Locust: no collision, no selection | Locust removes the unit from collision, selection, targeting and range enumeration | No collision, selection or enumeration exists | **Match** for what Smashcraft uses. Smashcraft enumerates no groups, so Locust's enumeration exclusion is not relied on |
| `PauseUnit(true)`: bodies never act on their own | A paused unit runs no orders, acquires no targets and does not move; direct position and facing writes still apply | No orders, AI or movement; the map declares `PauseUnit` a no-op | **Match** |
| Order queues | See [order queues](#order-queues-outside-the-maps-relied-on-behavior) | No order model | **Not used**: no `Issue*Order` call in Smashcraft |
| `CreateUnit` placement | A ground unit with collision is placed at the nearest free spot, so a second body at the same point can be displaced | Stores the requested point | **Not relied on**: Smashcraft overwrites X/Y in the same call (`placeFighterBody`) before anything reads them |

[Move speed native](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L3125-L3131),
[speed field](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L1872-L1879),
[pause native](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L4211-L4217),
[ability add native](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L4629-L4650),
[height setter](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L2633-L2690).

**Native capture** (wisp#61's third box, 8 Oct 2026, 3.0.1.24342, two
signed-in clients): `bun test/unit-movement61/build.ts BASE.w3m OUT.w3x`
played in a private game wrote `fly-height-needs-crow-form=38400,38400` and
`move-speed-set-and-read=34560` on both clients, now `EXPECTED` in
`test/headless-unit-movement.test.ts`.

## Timers and frame stepping

wisp#56 checks the timer behaviour Smashcraft relies on. Smashcraft
**db050997** calls `CreateTimer` (15 sites), `TimerStart` (14),
`TimerGetElapsed` (12), `DestroyTimer` (6), `PauseTimer` (4) and
`GetExpiredTimer` (1) in `ts/src/`. It calls no `TriggerSleepAction`,
`PolledWait`, timer events, `ExecuteFunc` or coroutines, so waits inside a
callback are outside this list. The uses are the 1/60 s simulation tick, the
zero-timeout start-up timer, the 1/32 s hot-reload poll, the 1,000-second
trace clock read as whole periods plus `TimerGetElapsed`, the smooth-draw
timer's fraction of a tick, and the development probes' 0.01 s, 1/1024 s and
zero periods.

Native evidence is Smashcraft's render-clock probe on Warcraft III
3.0.0.24268 (smashcraft:docs/high-refresh.md; raw reports in
`~/.local/state/smashcraft/accept/codex-native-render-clock-20261007/`). It
started a 3,600 s reference timer, a zero-period timer, a 1/1024 s timer and a
4 s stop timer in that order, and the stop timer paused the others. Three runs
at different frame rates gave the same counts:

- the 1/1024 s timer fired 4,096 times and the zero-period timer 40,329 times
  (about 10,080 a game second);
- callbacks came in bursts, one per game step, and steps lasted 1.2 to 67 ms of
  game time (median 16.6 ms at a 60 Hz output and 24.9 ms at 144 Hz); a burst
  held up to 61 callbacks of the 1/1024 s timer and up to 673 of the zero one;
- the reference timer's reading at the first callback of each 1/1024 s burst
  was a whole number of 1/1024 s;
- the last 1/1024 s callback read 3,999.023 ms, and the last zero-period
  callback read 3,999.756 ms.

Each rule below gives Warsmash's rule (from the subsection above), Wisp's
behaviour before and after wisp#56, and a verdict. The row is the fixture line
in `test/timers56/main.ts` that `test/headless-timers.test.ts` checks in Bun
and 32-bit Lua, and that the native capture must reproduce.

| Rule Smashcraft relies on | Warsmash rule | Wisp before | Wisp now | Verdict | Fixture row |
| --- | --- | --- | --- | --- | --- |
| A 1/60 s periodic timer fires 60 times a game second, one callback per headless frame (the simulation tick) | 50 ms turns, at most one callback per turn | 60 a second | 60 a second | **Match** with the native count. Warsmash's 20 Hz is not followed. | `ticks-in-one-second=60` |
| A period shorter than a frame catches up: the 1/1024 s timer fires 1,024 times a second | At most once per turn | Once per frame, 60 a second | 1,024 a second, 17 or 18 between two 1/60 s ticks | **Mismatch, fixed**, matching the native 4,096 in 4 s | `fast-in-one-second=1024`, `fast-between-ticks=17..18` |
| A zero period still repeats (smooth-draw, render-clock probe) | Once per turn | Once per frame, 60 a second | Minimum period 0.0001 s, 10,240 a second (about 170 a frame) | **Mismatch, fixed to within 1.6%**: native measured about 10,080 a second. The capture's count decides the exact minimum. | `zero-period-in-one-second=10240` |
| A zero-timeout one-shot fires once on the first step after it starts, at its start time (shell start-up) | Next turn | Next frame, reading 1/60 s later | Next frame, reading 0 | **Mismatch, fixed** | `zero-one-shot-reads-ms=0` |
| A timeout off a frame boundary fires when game time reaches it (1/32 s poll: 32 a second; 0.01 s probe) | Truncated to whole 50 ms turns | Rounded to the nearest frame: the poll ran every 2 frames, 30 a second | Kept to 1/61,440 s; fires in the frame whose end reaches it | **Mismatch, fixed** (test/hot-poll.test.ts now expects 32) | `in-frame-order=...` |
| Within a frame, callbacks run earliest deadline first | Per turn, then registration order | Creation order, ignoring deadlines inside the frame | Deadline order | **Mismatch, fixed** | `in-frame-order=earlier-deadline-first` first |
| Equal deadlines run in `TimerStart` order, and a periodic timer keeps its place | Registration order; a periodic timer re-registers each time it fires | Creation order | `TimerStart` order; a periodic timer keeps its place | **Mismatch, fixed.** The native 1/1024 s timer, started before the stop timer, still fired at their shared 4.0 s deadline (4,096 callbacks), so it keeps its place rather than re-registering. | `same-deadline=second-started-first` first; `ticks-in-one-second=60` |
| A timer started inside a callback first fires in a later step, after the callbacks still due in this one | Next timer phase | Next frame | Next frame | **Match** with Warsmash; no native evidence yet | `started-in-callback-fast-before=8` |
| Inside a callback, game time is that callback's deadline (trace clock and smooth-draw fraction) | Turn time | End of the frame | The callback's deadline | **Mismatch, fixed**, from the native readings on whole 1/1024 s. Open: the native last 1/1024 s callback read 3,999.023 ms where this model reads 4,000 ms; the capture's row decides whether a reading lags one period. | `fast-512th-reads-ms=500` |
| A periodic timer's elapsed time restarts each period (trace clock: periods × 1,000 s + elapsed) | Restarts at each period, capped at the period | Time since `TimerStart`, never reset: the trace clock would double-count after 1,000 s | Restarts each period | **Mismatch, fixed** | `periodic-between-ms=250`, `periodic-after-ms=250` |
| `GetExpiredTimer` is the timer whose callback runs (shell start-up destroys it) | The callback's own timer | Same | Same | **Match** | (start-up path of every headless journey) |
| `PauseTimer`/`DestroyTimer` stop later callbacks, including ones due later in the same step (render-clock stop) | Removed at the next timer phase; a callback already queued still runs | Stops at once | Stops at once | **Match** with the native counts, which show no callback after the stop | `zero-period-in-one-second`, `fast-in-one-second` |
| An expired one-shot reads its timeout; a paused timer keeps its elapsed time | Capped at the timeout; a paused timer's reading keeps advancing | Time since start, uncapped, also when paused | Timeout; frozen at the pause | Not read by Smashcraft after expiry or pause. Wisp follows the common Warcraft behaviour, not Warsmash; the capture confirms. | `expired-after-ms=500`, `paused-at-pause-ms=750`, `paused-later-ms=750` |

Headless deadlines are whole frames plus 1/1024ths of a frame (1/61,440 s),
so 1/60 s, 1/1024 s and 1/32 s are exact; a frame still ends at a whole 1/60 s,
as Smashcraft's netcode was measured against. Sync messages keep arriving
before a frame's timers ([network model](network-model.md)).

The native capture builds `bun test/timers56/build.ts BASE.w3m OUT.w3x`, plays
it in a two-player 3.0.1 private game for at least 1.25 game seconds and
collects `timers56-p0.txt` and `timers56-p1.txt`. Each must equal
`EXPECTED` in `test/headless-timers.test.ts`, except the zero-period count,
which should be about 10,080.

## Sound start, stop and channel limits

wisp#60 checks the sound behaviour Smashcraft relies on. Smashcraft
**98fcf4b** (`ts/src/`, excluding tests) calls `StartSound` (8 sites),
`SetSoundPosition` (7), `KillSoundWhenDone` (6), `SetSoundVolume` (5),
`StopSound` (5), `CreateSoundFromLabel` (5), `CreateSound` (4),
`SetSoundDuration` and `GetSoundFileDuration` (3 each), `SetSoundDistances`
and `SetSoundDistanceCutoff` (2 each) and `SetSoundPitch` (1), in
`game/render/`: `combatEffects.ts`, `matchPresentation.ts`,
`specialEffects.ts`, `bearFeedback.ts` and `modelSoundPresentation.ts`. Its
patterns are: a new handle per cue, positioned, started and released with
`KillSoundWhenDone` in one call (hits, swings, model sounds, voice lines,
announcer); a kept handle replayed with `StopSound` then `StartSound` (menu
hover, item cues); a fighter's voice cut off by `StopSound` on its last line,
which may already have been released; and Immolation's looping label sound,
started when lit, stopped with a fade-out when it goes out, and released with
`StopSound` plus `KillSoundWhenDone`. It never reads `GetSoundIsPlaying` or
`GetSoundDuration`; it calls no `SetSoundChannel`, `AttachSoundToUnit`,
`StartSoundEx` or volume groups. Music natives are listed as not modelled by
Smashcraft's headless declarations and are outside this section.

Warsmash (the researched revision above) gives little here: `StartSound`
asks the audio backend for a new voice on every call, with no check that the
handle is already playing and no cap on voices per file, label or channel;
`StopSound`, `KillSoundWhenDone` and `GetSoundIsPlaying` are not registered;
pitch and volume setters do nothing. The Warcraft rules below are the ones map
authors work around (Smashcraft's own `StopSound`-before-`StartSound` on kept
handles exists because of the first), recorded here for the capture to
confirm. The fixture reads `GetSoundIsPlaying` only as a probe; each case
samples it at a fraction of the file's length, away from the start and end.

| Rule Smashcraft relies on | Warcraft rule | Warsmash rule | Wisp before | Wisp now | Verdict | Fixture row |
| --- | --- | --- | --- | --- | --- | --- |
| `StartSound` on a handle that is still playing (Immolation re-lit; why hover and item cues stop first) | A handle has one voice: the call neither restarts it nor adds a voice | A new voice each call | A second start cue; the remaining time restarted | Ignored: no cue, the first playback ends on time | **Mismatch, fixed** | `start-while-playing-at-1.25=false` |
| `StopSound(s, false, false)` then `StartSound(s)` in one call (hover, item cues) | Restarts from the beginning | Not registered | Restarts | Restarts | **Match** | `stop-then-start-at-1.25=true` |
| `KillSoundWhenDone` right after `StartSound` (every one-shot cue) | The sound plays out, then the handle is released; from the call on, `GetSoundIsPlaying` reads false (3.0.1 capture, both clients) | Not registered | Plays out, then released; read as playing until it ends | Plays out, then released; read as not playing from the call | **Mismatch, fixed** from the native rows. Smashcraft never reads `GetSoundIsPlaying` | `kill-when-done-at-0.5=false` |
| `StopSound` on a handle set to be killed (voice cut-off, Immolation release) releases it; stopping or starting a released handle does nothing | Released by the stop; later calls on it are ignored | Not registered | Released; later calls ignored | Same | **Match** | `stopped-kill-when-done-restarted=false`, `released-handle-started=false` |
| `SetSoundPitch` changes how long a cue plays (swing pitch per tier) | Pitch is a playback-rate factor: pitch 2 ends in half the time | Setter does nothing | Ends at duration ÷ pitch | Same | **Match** | `pitch-two-at-0.25=true`, `pitch-two-at-0.75=false` |
| `SetSoundPitch` and `SetSoundPosition` values (cue log) | `real` arguments are binary32 | Position not registered; pitch ignored | Stored unrounded: Bun's cue log kept doubles that Lua32 rounds | Stored as binary32 | **Mismatch, fixed** | Bun-only case in `test/headless-sounds.test.ts` (no getter in the game) |
| `StopSound(loop, false, true)` then a later `StartSound` (Immolation out, then lit again) | The fade-out ends the loop; a later start plays it again | Not registered | Stops at once; a later start plays | Same | **Match** for the later start. How long the fade lasts is audible only and stays with the capture | `fade-stopped-loop-at-1=false`, `fade-stopped-loop-restarted=true` |
| Several new handles of one file or label started in one frame (a burst of hits and swings) | Each handle has its own voice; no per-file or per-channel cap is established. The engine's total voice count is finite and the quietest or lowest-priority voices may be dropped, which a script cannot see | No cap | No cap; each start is a cue | Same | **Native unresolved**: the fixture's 12 handles are set to be killed, so 3.0.1 reads all of them as not playing and the row can't count voices. Smashcraft can't observe a dropped voice either | `same-file-playing=0/12` |
| `GetSoundFileDuration` feeding `SetSoundDuration` (announcer, voice, item and hover cues) | The file's length in milliseconds; 0 when missing | Decoded duration | Unmodelled: a map declares it or supplies it | Same; the fixture supplies 2,000 ms for its file | **Not applicable**: headless decodes no sound files, so a game supplies lengths through `natives` | (every case is timed from it) |

A label sound with no `SetSoundDuration`, or a file whose length a game does
not supply, has a headless length of 0, so it is never playing after its
start and a second start is always a new cue. Natively it plays for its
file's length; a map that restarts such a handle without stopping it should
supply the length.

The native capture builds `bun test/sounds60/build.ts BASE.w3m OUT.w3x`, plays
it in a two-player 3.0.1 private game for at least 0.5 game seconds plus 1.5
times the fixture file's length and collects `sounds60-p0.txt` and `sounds60-p1.txt`.
Each must equal `EXPECTED` in `test/headless-sounds.test.ts`; the rows'
order depends only on fractions of the file's length, so the stock file's
real length (rather than headless's 2,000 ms) keeps the same rows. A
`missing-file=...` row means the stock path is wrong for that build, or the
client has no audio device: `GetSoundFileDuration` then reads 0 on that client
only, and the game desyncs. On 8 Oct 2026 (3.0.1.24342, two signed-in clients,
each on its own silent PipeWire sink) both clients wrote the ten `EXPECTED`
rows.

## File-format facts for a standalone player (#48)

These are parseable format facts. Native acceptance of a particular model
version still requires loading that fixture in the target Warcraft build.

| Format fact | Primary source |
| --- | --- |
| MDX begins with ASCII `MDLX`; numeric values are little endian. Chunks carry a four-byte tag and 32-bit payload length. `VERS` declares the model version; classic default is 800. | [reader byte order](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/hiveworkshop/rms/util/BinaryReader.java#L8-L11), [model header/chunks](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/hiveworkshop/rms/parsers/mdlx/MdlxModel.java#L103-L133) |
| A `SEQS` entry is 132 bytes: 80-byte name, two unsigned 32-bit interval bounds, float move speed, 32-bit flags, float rarity, unsigned 32-bit sync point, and 28-byte extent. Extent is float radius followed by minimum and maximum XYZ float vectors. NonLooping is flag 1. | [sequence fields](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/hiveworkshop/rms/parsers/mdlx/MdlxSequence.java#L18-L37), [extent](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/hiveworkshop/rms/parsers/mdlx/MdlxExtent.java#L14-L28) |
| An animation track records key count, interpolation identifier and global-sequence index before its keys. Global index −1 means ordinary sequence time. Each key contains its 32-bit time and typed value; Hermite and Bezier add incoming and outgoing tangent values. Interpolation IDs: 0 step, 1 linear, 2 Hermite, 3 Bezier. | [track format](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/hiveworkshop/rms/parsers/mdlx/timeline/MdlxTimeline.java#L32-L57), [interpolation IDs](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/hiveworkshop/rms/parsers/mdlx/InterpolationType.java#L3-L20) |
| `GLBS` contains 32-bit durations; `PIVT` contains XYZ float triples. Models also carry mesh/material, bone/helper, attachment, camera, light, emitter and event chunks; a pose-only player should report unsupported visible content explicitly. | [chunk formats](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/hiveworkshop/rms/parsers/mdlx/MdlxModel.java#L124-L191) |

For asset lookup, Warsmash gives map contents priority over installed game
assets and searches configured sources from last to first. It accepts either
an MPQ map archive or a map directory. Map components include `war3map.w3i`
(configuration), `war3map.w3e` (terrain), `war3map.wpm` (pathing),
`war3map.doo`, `war3mapUnits.doo`, and object modifications. Terrain stores
tile lists, grid dimensions, offsets and row-major corner records; pathing
stores dimensions followed by one byte per cell.
[Lookup priority](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/datasources/CompoundDataSource.java#L77-L91),
[map sources and components](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/w3x/War3Map.java#L57-L154),
[terrain fields](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/w3x/w3e/War3MapW3e.java#L32-L62),
[pathing fields](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/w3x/wpm/War3MapWpm.java#L26-L38).

The standalone application requests OpenGL 3.3, takes an explicit data-source
INI, and supports a direct map launch after its menu initializes. Its
documented supported installations span classic MPQ layouts and selected
CASC/Reforged layouts. This is evidence that owning an asset resolver is a
necessary standalone-player boundary; it is not evidence that Warsmash runs
Wisp's current Lua maps or provides current `Blz*` coverage. Game assets are
supplied privately by the owner's Warcraft installation.
[Launcher](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/desktop/src/com/etheller/warsmash/desktop/DesktopLauncher.java#L47-L126),
[installation/data-source notes](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/README.md#before-you-begin-ini-file).

The inspected default script list contains `common.j`, `Blizzard.j` and
`war3map.j`. At game initialization, ability initialization is scheduled
before map `main`; map `config` is run to completion in its configuration
context. Those are JASS execution observations. A player for Wisp's compiled
Lua must provide Lua execution and its declared natives independently.
Rendering also has its own elapsed-time updates, separate from 50 ms
simulation steps; a player should use the recorded animation time when
reproducing a captured pose, not infer it from the simulation step count.
[Default script list](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/util/WarsmashConstants.java#L60),
[initialization order](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L9201-L9223),
[configuration](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/parsers/jass/Jass2.java#L9394-L9403),
[render and simulation timing](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/War3MapViewer.java#L1140-L1207).

## Browser player: asset readiness and pacing for #48

The browser-focused [ErikSom HTML fork](https://github.com/ErikSom/WarsmashModEngine/tree/d69e772b4dede6fd3569f9949a3180cdfea4635b)
was inspected at **d69e772b4dede6fd3569f9949a3180cdfea4635b**, which declares
[AGPL-3.0](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/LICENSE).
The same facts-only scope above applies. These findings are independently
worded observations of that revision, not a Wisp implementation recipe.

**Live-page observation, 8 October 2026:** [warsmash.pages.dev](https://warsmash.pages.dev/)
displays **v0.2.0**, offers single-player/campaign and multiplayer entry
points, and describes user-supplied Warcraft files and maps retained in
private browser storage (OPFS). Its multiplayer description specifies
lockstep WebRTC peer-to-peer play without requiring a server installation.
This verifies the displayed claims, not a played match. The deployed page
does not establish that its engine bytes match the inspected Git revision.
“No server installation” also does not mean no service dependency: the
fork's [0.2.0 changelog](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/html/CHANGELOG.md#020--may-2026)
explicitly describes a signalling server for lobby departure notifications.

| Source-researched fact in the HTML fork | Meaning for the current #48 measurement | Primary source |
| --- | --- | --- |
| Asset staging finishes each file write and closes it before publishing the staged-file index and ready marker. The marker means staged bytes are available; it does not record model parsing, texture decoding or GPU uploads. | Keep staging completion separate from the measured first playable frame. | [staging completion](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/html/web-src/src/lib/assetStaging.ts#L129-L170), [ready marker](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/html/web-src/src/lib/assetStaging.ts#L38-L48) |
| Before engine startup, its bundled asset fetches, OPFS file indexing and WebAssembly startup finish. The menu is installed before the render clock starts. The browser UI treats installation of the map screen as reaching the game. | Those events are useful loading milestones; neither is a measured GPU warmup or first-simulation-step duration. | [startup prerequisites](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/html/webapp-src/engine-worker-boot.js#L254-L272), [menu before rendering](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/html/src/com/etheller/warsmash/html/engineworker/EngineWorkerMain.java#L137-L156), [visible readiness events](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/html/web-src/src/lib/engineBoot.ts#L85-L99) |
| The inspected browser startup mounts `war3.mpq`, `war3local.mpq`, `war3x.mpq` and `war3xlocal.mpq`, with later archives taking precedence, and reads loose maps. It bypasses the older extracted-files boot screen. | The README's `.w3-ready` extraction wait and preload tuning describe another startup path. They should not be treated as proof that the current browser prepares all scene assets before play, or accepts current CASC installations. | [mounted archives and loose maps](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/html/src/com/etheller/warsmash/html/engineworker/EngineWorkerMain.java#L196-L278), [extraction-screen bypass](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/html/src/com/etheller/warsmash/html/engineworker/EngineWorkerMain.java#L294-L315), [older documented boot](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/html/README.md#asset-staging) |
| A requested BLP texture is read and decoded during texture loading. Map initialization loads post-UI map content and schedules map script initialization before its first render. Later script-created content can still request resources during play. | Source inspection supplies no measured absence of first-use stalls after ready. The current #48 work should decide that from its own first-round intervals, including new effects. | [texture loading](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/core/src/com/etheller/warsmash/viewer5/handlers/blp/BlpGdxTexture.java#L32-L40), [map initialization](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/core/src/com/etheller/warsmash/WarsmashGdxMapScreen.java#L222-L230) |
| Render elapsed time is the actual difference between successive worker `requestAnimationFrame` timestamps, expressed in seconds. The first frame has zero elapsed time. A late rendered frame therefore advances the render clock by its actual gap. | Render work duration and the interval between displayed frames are separate measurements. This helps explain why a work-time p95 can pass while interval p95 misses. | [frame scheduling](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/html/src/com/etheller/warsmash/html/engineworker/EngineWorkerMain.java#L579-L583), [elapsed time](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/html/src/com/etheller/warsmash/html/engineworker/WorkerGraphics.java#L72-L87) |
| Simulation advances in **50 ms** steps from accumulated elapsed time. Multiple already-completed turns can advance during one rendered frame; the inspected timing path has no maximum catch-up count. When waiting for a completed network turn, accumulated delay is discarded only when it is strictly greater than **150 ms**. Rendering and animation also consume elapsed time independently of the simulation step count. | These are fork behaviors, not native Warcraft confirmation or pacing values to adopt in Smashcraft. Late-frame behavior must be judged against #48's declared pace check. | [step duration](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/core/src/com/etheller/warsmash/util/WarsmashConstants.java#L20), [render and simulation clocks](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/core/src/com/etheller/warsmash/viewer5/handlers/w3x/War3MapViewer.java#L1140-L1196) |

The fork's [0.1.2 changelog](https://github.com/ErikSom/WarsmashModEngine/blob/d69e772b4dede6fd3569f9949a3180cdfea4635b/html/CHANGELOG.md#012--april-2026)
attributes faster startup partly to disabling heavy first-tick AI
initialization, and describes single-player without computer opponents.
That is a documented change, not a timing measurement or equivalent workload
to #48's four-fighter match. No browser gameplay, GPU first-use timing or
Warcraft-native behavior was measured in this research pass.

## Native confirmations still queued

| Question | Existing fixture or next observation | Status |
| --- | --- | --- |
| Warcraft life threshold, clipping, corpse writes and removal | #44's existing twelve-case [unit-state fixture](headless.md#unit-states), including exact binary32 0.40625 and 0.3984375 | No native values measured. Ready map retained privately at `~/.local/state/wisp/unit-states44/`. Sole native coordinator has the required journey; current blocker is Warcraft 3.0.1/build 24342 startup, with a private online fallback authorized. |
| Widget/unit/player death callback order and repeated kills | A callback log with before/inside/after life and event names | Source-researched only; not an additional #44 acceptance fixture. Defer until a consuming check needs this order. |
| Blend setting, frozen clock and the pose discrepancy | #40's existing same-frame-262 capture, followed by the held-frame capture at least 250 ms later and recorded camera state | Retained comparison is 24 of 25 passing; the red-flag landmark differs vertically by 40.73 pixels. Diagnostic candidate `8aad61e8` has produced no new captures because of build 24342 startup. Cause unresolved; native coordinator owns execution. |
| Sequence end/loop overshoot and queued animation timing | The [animation playback capture](#animation-playback) | Headless follows the source-researched rules since wisp#58; queued animations stay unused by Smashcraft. |

The existing native executor owns clients and fixture scheduling. Research
does not start another client. Unit and pose workers received the factual
findings directly; native results should amend this table with the exact
fixture, build and measured outcome.
