# Wisp feature index

## Machine-readable results

`headless`, `soak`, `repro`, `accept`, and `perf` support `--json`: one JSON
object per result and a final summary with verdict, counts, and elapsed time.
See the [CLI fields](cli.md), [headless](headless.md), [soak](soak.md),
[repro](repro.md), [accept](accept.md), and [performance](frame-cost.md) pages.

Game-specific [`wisp combos`](cli.md) measures each fighter's true combos and
openings per kill through the game's deterministic frame executor. The game
defines its search, route replay checks and reported balance measure.
