# Fidelity gates

`bun wisp fidelity check LEVER --reference DIR --candidate DIR` reads each
folder's `manifest.json` and PNG captures. Capture manifests follow
[the capture contract](fidelity-captures.md). Keep private captures outside Git.

The tool compares only frozen held-out scenes. Fit and retired scenes,
different capture identities, pads, frame lists, cameras, controls, metric
regions, settings or calibrated ranges are refused before images are read.
Every setting must lie inside its declared calibration range. Reference and
candidate use the same calibration; the candidate cannot widen it.

Each selected frame, control and region is checked independently. The maximum
pairwise distance across reference runs is the reference spread. A spread
strictly greater than half the fixed bound returns `INCONCLUSIVE`; the bound
is never widened. Otherwise every candidate run must be within the full bound
of every reference run. A distance greater than the bound returns `FAIL`.
The overall result is `INCONCLUSIVE` if any region has unstable references,
then `FAIL` if any stable region fails, otherwise `PASS`.

The command prints one JSON result with per-frame, control, region and metric
measurements. PASS exits zero; FAIL, INCONCLUSIVE and refused inputs exit
nonzero. Nonfinite errors are printed as strings.

| Lever | Metrics and hard bounds |
| --- | --- |
| `sky` | Top tenth of the region: mean sRGB colour converted to Lab, ΔE00 ≤ 5; largest horizontal luma discontinuity's horizon row within 4 rows |
| `fog`, `height-fog-falloff`, `water` | Region mean colour ΔE00 ≤ 5 |
| `cinematic-filter` | Region mean colour ΔE00 ≤ 5 and mean luma within 5 on the 0–255 scale, on every listed frame |
| `dof` | Mean absolute adjacent-pixel luma gradient in each declared depth band within 15% |
| `bloom` | Nine equally spaced horizontal luma samples through each region's middle row within 10%; count of pixels above calibrated `thresholdLuma` within 20% |
| `day-night-light`, `point-lights`, `pbr` | Region mean L* within 3 |

Relative distances use the reference measurement as denominator. A zero
reference matches only zero. Unknown levers and levers without decided
bounds are refused. Define separate regions for fighter plane, backdrop,
sky, sea, individual fog cells and every critical area. The tool never merges
these regions or averages errors across frames. Regions specify the pixel
measurements; they must isolate the named feature. The L* shading metric
covers lightness only: fighter/team-colour, material-gradient and rubric
requirements still need their own decided metrics and captures. Fog on/off
controls are compared independently; differential fog coverage remains a
separate gate requirement.

Public tests generate synthetic PNGs and check the gate's three verdicts,
fixed bounds and input refusals. Native references and calibration are supplied
by the owning VM capture batch; synthetic fixtures establish tool behavior.
