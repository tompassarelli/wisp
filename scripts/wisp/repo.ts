// Wisp's own commands, for work on this repository.
// Usage (from the Wisp checkout): bun wisp COMMAND [ARGUMENTS]
import { runCli } from "./cli";

process.exit(await runCli("bun wisp", {
  farm: { usage: "test [--ref REF] [--wait]   (the full suites on GitHub's free runners: docs/farm.md)", load: async () => (await import("./commands/farm")).farm },
}, process.argv.slice(2)));
