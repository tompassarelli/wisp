# Wisp

## Direction

Wisp exists to verify Warcraft III maps without waiting on Warcraft III.
Every check that still needs a native client is a gap to close: move it
headless (simulation, cost model, rendered frames, cue logs), or drive the
offline client from inside under wisp:docs/engine.md's guardrails, never
through the OS keyboard or chat. Judge each step by checks per hour per
machine and by setup failures, and prefer the frontier move over another
workaround around the client.
A native check of a TypeScript-only change hot-reloads into the running
match (`wisp hot --watch`, wisp:docs/hot-reload.md) instead of rebuilding.

Before implementing a feature here or in a consuming map, consult the
[feature index](docs/index.md) (wisp:docs/index.md) for existing capabilities
and opt-in setup, especially TypeScript stack traces. A feature isn't done
until wisp:docs/index.md lists it and a how-it-works page in wisp:docs/
explains it; wisp:test/docs-index.test.ts enforces the index for every command
in wisp:scripts/wisp/commands/, and each subcommand on its command's own page
(wisp:docs/NAME.md) when it has one.

Wisp owns reusable Warcraft III TypeScript compilation, numeric guards,
hot reload, runtime error reporting and host services. Its existing TypeScript
source and immutable compiler/tool pins are declared in
wisp:typescript-toolchain.lock. Use Bun. Keep Effect in host code;
synchronized Lua code remains pure TypeScript and Warcraft native calls.

Every check gets one run on a commit: it passes, ship; a failure gets fixed
and run once more. Load-bearing rules get one run of the broader check (the
farm sweep or parity corpus), not repeats: Bun/Lua parity and determinism.

Read warcraft-modding and verification for
changes. The operator explicitly authorized extracting the existing framework;
the skill's earlier in-Smashcraft deferral does not apply to this extraction.
Host tools that Bun runs (commands, runners, builds, captures, farm jobs) are
written as Effect programs when they start processes, wait, retry, hold a
resource or parse outside data. Load the effect-development skill before
designing one, and follow the pattern and examples in
[Host tools](docs/host-tools.md) (wisp:docs/host-tools.md). Map code compiled to Lua stays plain
TypeScript; pure calculations stay plain functions.
wisp:test/effect-host-tools.test.ts enforces this. Read the installed pinned
Effect source before choosing its APIs. Runtime imports must resolve through
the installed package.

No Smashcraft source imports or filesystem dependencies. Games supply their
configuration, assets, map declaration and acceptance journeys. Keep proprietary
assets and binaries outside this repository. No releases are authorized.

Test cost: one test may use at most 4 s of CPU (user plus system, with the
Lua32 and compiler children it waits for; wisp:scripts/wisp/testCost.ts). It
was set on 8 Oct (#65), when the heaviest suite test used 2.9 s and the 28
tests above about 2 s became `farmTest`s, which CI's farm-tests job runs on
every push. Only Tom raises it. `bun run test` fails a test over it, and on a
whole run a file whose CPU per test rises more than 25% over its row in
wisp:test/cost-baseline.tsv, naming the file and "shrink it or move it to the
farm"; it prints the suite's CPU, test count and CPU per test
(wisp:docs/testing.md, "Test cost").

Main stays green. Each CI run on main opens, updates or closes the one
"main is red" issue, which lists the failing tests and the first failing
commit, and every push prints that list (wisp:docs/ci.md, "Main stays green").
A red main is not "already failing": if your commit broke it, fix it first.

Use owned lanes, named staging and safe-push. Preserve current immutable pins.
Native client control belongs to the accountable parent run for this extraction.
