import { alive, preferencesBackupPath, preferencesPath, restorePreferences } from "../os/warcraft/preferences";

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Effect, Runtime, Schema } from "effect";
import { pollUntil } from "../cli/hostProcess";

class PreferencesFailure extends Schema.TaggedError<PreferencesFailure>()("PreferencesFailure", { cause: Schema.Unknown }) {
  override get message() { return String(this.cause); }
}

class PreferencesUsage extends Schema.TaggedError<PreferencesUsage>()("PreferencesUsage", {}) {
  override readonly [Runtime.errorExitCode] = 2;
  override get message() { return "usage: restorePreferences.ts PID DOCUMENTS"; }
}

if (import.meta.main) {
  BunRuntime.runMain(Effect.gen(function*() {
    const args = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.NumberFromString.pipe(Schema.check(Schema.isInt())), Schema.String]))(Bun.argv.slice(2, 4)).pipe(
      Effect.mapError(() => new PreferencesUsage({})),
    );
    const [pid, documents] = args;
    if (alive(pid)) {
      console.log(`waiting for process ${pid}`);
      yield* pollUntil(Effect.sync(() => alive(pid)), { until: running => !running, every: "1 second" });
    }
    const restored = yield* Effect.tryPromise({
      try: () => restorePreferences(preferencesBackupPath(documents), preferencesPath(documents)),
      catch: cause => new PreferencesFailure({ cause }),
    });
    console.log(restored ? "restored War3Preferences.txt" : "no saved War3Preferences.txt");
  }));
}
