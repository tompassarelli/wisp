# Wisp

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

Read warcraft-modding and verification for
changes. The operator explicitly authorized extracting the existing framework;
the skill's earlier in-Smashcraft deferral does not apply to this extraction.
Read effect-development when changing Effect host services. Read the installed pinned Effect source before choosing its APIs. Runtime
imports must resolve through the installed package.

No Smashcraft source imports or filesystem dependencies. Games supply their
configuration, assets, map declaration and acceptance journeys. Keep proprietary
assets and binaries outside this repository. No releases are authorized.

Use owned lanes, named staging and safe-push. Preserve current immutable pins.
Native client control belongs to the accountable parent run for this extraction.
