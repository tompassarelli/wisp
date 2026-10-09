# Wisp test boundaries

- Run synchronized rules in Bun and emitted Lua 5.3 with `LUA_32BITS`;
  nearest and toward-zero builds are separate external numeric references.
- Keep binary32 and signed integer fixtures exact. Compiler fixtures may use
  triple-slash directives; those are compiler inputs, not narration to prune.
- Engine observations come from the recorded rows and sessions named in
  `docs/warsmash-notes.md`; renderer checks exercise authored models in Classic
  and Definitive and retain their measured pixel rules.
- Keep unconfirmed engine expectations marked provisional. Headless agreement
  alone never changes their status to a native reference.
- A consumer's supplied game, replay inspector or asset source is input to Wisp.
  Wisp host services use their real layers and files, processes or protocols.
- Scope checks observe exit and owned child cleanup; kill only the fixture's
  exact marked descendants. Never start a real signed-in or offline game here.
- Full suites, Lua32 compilation and render sweeps run on the farm. Keep the
  per-test instruction and frame ceilings and 25% file-cost gate in `AGENTS.md` unchanged.
- Melee numerical facts may be external fixtures. ISO images, extracted game
  files, proprietary assets and account data stay outside this repository.
- Every test is one of five kinds; new titles name it first: `[scenario]`,
  `[property seed N]`/`[invariant]`, `[spec ...]` measurement, `[native]`/
  `[reference]` external truth, or `[boundary]`. Fold a new bug's input into
  the owning rule's test instead of adding a `[repro]` test.
- Fakes stand only for what Wisp doesn't control (Warcraft's menu socket, a
  capture tool, a clock) and enter as input; never fake a Wisp service layer.
- Source-policy lints run in `effect-kit check` (wisp:effect-kit.json),
  not in the suite. `../docs/test-audit.md` records the #104 audit.
