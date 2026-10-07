# Warsmash behavior notes

Research date: 7 October 2026. These independently written facts inform
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
| Observable death notifications occur in this order: widget-death, unit-death, owning-player unit-death. The life value is already dead, orders have ended, and food bookkeeping has been updated. Explosion removal follows these notifications. | Register all three kinds of callback and append their names, observed life and food to one log. Replacement/reincarnation abilities need a separate fixture. | [death notifications](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L2975-L3040), [notification order](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L3116-L3129) |

Warsmash simulation steps are **0.05 seconds**, or 20 Hz. Each corpse phase
ends on the first step strictly later than its start step plus the duration
divided by 0.05, rounded down to an integer. Death animation duration comes
from unit data; flesh, bone and structure decay durations come from gameplay
data. A nonhero without decay disappears after its death phase; a hero can
remain hidden awaiting revival. These are emulator timing facts, not values
to adopt for current Warcraft. See [step constant](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/util/WarsmashConstants.java#L20),
[corpse transitions](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CUnit.java#L1897-L1949),
and [decay data](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation/CGameplayConstants.java#L137-L140).

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

## Native confirmations still queued

| Question | Existing fixture or next observation | Status |
| --- | --- | --- |
| Warcraft life threshold, clipping, corpse writes and removal | #44's [unit-state fixture](headless.md#unit-states), including exact binary32 0.40625 and 0.3984375 | Native executor queued; no native verdict recorded here yet. |
| Widget/unit/player death callback order and repeated kills | A callback log with before/inside/after life and event names | Requested from the shared native executor; source-researched only. |
| Blend setting, frozen clock and the 0.3/0.4-second pose discrepancy | #40's retained frames, then one-variable blend-zero comparison if needed | Native pose discrepancy observed; cause unresolved. |
| Sequence end/loop overshoot and queued animation timing | A model with explicit interval bounds at time scales 0, 0.5, 1 and 2 | Source-researched only; defer until a consuming check requires it. |

The existing native executor owns clients and fixture scheduling. Research
does not start another client. Unit and pose workers received the factual
findings directly; native results should amend this table with the exact
fixture, build and measured outcome.
