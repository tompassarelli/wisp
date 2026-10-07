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
| Sequence end/loop overshoot and queued animation timing | A model with explicit interval bounds at time scales 0, 0.5, 1 and 2 | Source-researched only; defer until a consuming check requires it. |

The existing native executor owns clients and fixture scheduling. Research
does not start another client. Unit and pose workers received the factual
findings directly; native results should amend this table with the exact
fixture, build and measured outcome.
