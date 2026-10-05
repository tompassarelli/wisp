# Wisp

Before implementing a feature here or in a consuming map, consult the
[feature index](docs/index.md) (wisp:docs/index.md) for existing capabilities
and opt-in setup, especially TypeScript stack traces.

Wisp owns reusable Warcraft III TypeScript compilation, numeric guards,
hot reload, runtime error reporting and host services. Its existing TypeScript
source and immutable compiler/tool pins are declared in
wisp:typescript-toolchain.lock. Use Bun. Keep Effect in host code;
synchronized Lua code remains pure TypeScript and Warcraft native calls.

Read warcraft-typescript-development-distilled and verification-distilled for
changes. The operator explicitly authorized extracting the existing framework;
the skill's earlier in-Smashcraft deferral does not apply to this extraction.
Read effect-development-distilled when changing Effect host services. Read the installed pinned Effect source before choosing its APIs. Runtime
imports must resolve through the installed package.

No Smashcraft source imports or filesystem dependencies. Games supply their
configuration, assets, map declaration and acceptance journeys. Keep proprietary
assets and binaries outside this repository. No releases are authorized.

Use owned lanes, named staging and safe-push. Preserve current immutable pins.
Native client control belongs to the accountable parent run for this extraction.
