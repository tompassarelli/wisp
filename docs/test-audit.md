# Test pruning (#104): first piece

Done when

- [x] Remove reviewed tooling scaffolding and injected host decisions; fold
  useful inputs into retained pure rules and real-file boundaries.
- [x] Finish the repository-wide five-kind audit: remaining own-code fakes,
  repro folds, full cost measurements, deliberate-fault checks and exact-commit
  farm evidence before closing #104.

Not required: gameplay changes, native client starts, proprietary inputs,
wider budgets, confidence reruns, or further test work for this first piece.
Tom stopped further audit and test work before landing this piece.

| Reviewed area | Disposition and owning retained rule |
| --- | --- |
| CLI argument examples | Fold into the seeded value-boundary property. |
| Doctor mock launch/recovery world | Delete injected decisions; fold diagnosis inputs into the pure state/age property. Keep recorded launcher and login facts, real pool-file round-trip and preference idempotence. Real launch/recovery boundary coverage remains pending. |
| Play mock launch/recovery world | Delete injected decisions. Keep the two recorded launcher/configuration references. Real launch/recovery boundary coverage remains pending. |
| Host services | Fold fake hot folders and source maps into the real-file isolation scenario; fold Preload examples into generated numeric/text boundaries and cache ages into a freshness property. Delete the checksum comparison against the same implementation. |
| Model failure bridge, handle cleanup | Use real GameFiles and SourceErrors layers with actual files instead of replacing Wisp services. |
| Watch and desktop chat | Delete injected ClientWatch decisions. Keep recorded socket/log inputs and pure state rules; the full adapter audit remains pending. |
| Desktop capture | Keep producer bytes, timestamp bounds and owned process cleanup; delete the redundant wall-clock lower bound. |
| Map build and pack | Fold minimap replacement into generated case-alias/order/idempotence coverage. Keep real archive precedence/bytes, Scope cleanup and format boundaries. Delete the fake archive, installed-version assertion and implementation-derived FileIO expectation; fold archive growth into the retained real-archive scenario. |
| Object data | Keep the independent format decoder and authored numeric reference. Delete local assertion/type-check scaffolding and its isolated compiler fixtures. |
| Soak backlog | Keep the catch-up input rule using the actual headless runtime instead of a cast fake Lockstep. |
| Dev, docs index, Effect host policy, farm scratch, main-red, traps | Delete runner, source-policy, fake-farm and compiler change-detector scaffolding. Keep traps compiler fixtures consumed by number-rules. |

Source declarations decrease from 382 to 321: 61 fewer rules (16%). The deleted
farm-scratch table also registered two cases outside that declaration count,
giving a net reduction of 63 test registrations. These are source-accounting
counts; a complete post-prune suite was not run.

[CI run 37889938312](https://github.com/tompassarelli/wisp/actions/runs/37889938312)
on `dc5d93251f893df1a1501b11975034d867dba7d3` passed 319 ordinary rules and
42 farm rules. Its ordinary suite used 15.3 CPU seconds (0.048 seconds per
rule). The rewritten three-rule host-services sample passed with 98 assertions
and measured 0.017 CPU seconds per rule. Eleven retained doctor, play,
model-failure and CLI rules also passed during the targeted check. A discarded
desktop executable experiment timed out because its synthetic Windows process
name was rejected by the Nix multicall executable; that experiment is absent
from this change. These samples are not a whole-suite before/after comparison.

The 4 CPU second ceiling and 25% file-cost gate remain unchanged. Baseline rows
were removed only for deleted files; remaining file costs await the full audit.

## Second piece: the remaining audit

All 284 source declarations were classified keep, fold or delete. Deleted:
the lobby, accept and LAN dummy tests, which replaced Wisp's own service
layers or functions, and the Effect host-boundary source lint, which now runs
in `effect-kit check` (wisp:effect-kit.json). Every `[repro]` test
either folded into the scenario or property that owns its rule (watch, menus,
pause, map staging, render assets, soak catch-up, doodads) or, where it was
that rule's only test, kept its input under the rule's kind
(`[boundary]`, `[invariant]`, `[reference ...]`). Same-rule tests merged in
builds, CI map build, effect opacity, effect binary32, graphics modes, JSON
results, desktop capture and doctor preferences.

A deliberately broken rule failed its kept test for each kind: the menus
socket scenario (watch), the case-alias property (map build), the 20% native
fit tolerance (native fit), binary32 addition against the binary64 oracle,
and the sha256 store format (CI map build).
