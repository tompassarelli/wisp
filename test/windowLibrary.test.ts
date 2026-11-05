import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cachedWindowLibrary, windowBuildEnvironment } from "../host/window/library";

test("[spec docs/native-window-plan.md] a change to the crate's manifest, source or assets moves the cached library", () => {
  const folder = mkdtempSync(join(tmpdir(), "window-library-"));
  try {
    cpSync(join(import.meta.dir, "../window/Cargo.toml"), join(folder, "Cargo.toml"));
    const seen = new Set([cachedWindowLibrary(folder, "libwisp_window.so")]);
    for (const file of ["wisp-window/Cargo.toml", "wisp-window/src/lib.rs", "wisp-window/src/render/shader.wgsl", "wisp-window/assets/font.ttf"]) {
      mkdirSync(dirname(join(folder, file)), { recursive: true });
      writeFileSync(join(folder, file), "first");
      seen.add(cachedWindowLibrary(folder, "libwisp_window.so"));
      writeFileSync(join(folder, file), "second");
      seen.add(cachedWindowLibrary(folder, "libwisp_window.so"));
    }
    expect(seen.size).toBe(9);
  } finally {
    rmSync(folder, { recursive: true });
  }
});

test("[spec docs/native-window-plan.md] the library builds incrementally through build.incremental and keeps the player's rustc wrapper, since sccache refuses any build under CARGO_INCREMENTAL", () => {
  const environment: Record<string, string> = windowBuildEnvironment("/target", "hash");
  expect(environment.CARGO_BUILD_INCREMENTAL).toBe("true");
  expect("CARGO_INCREMENTAL" in environment).toBe(false);
  expect("RUSTC_WRAPPER" in environment).toBe(false);
  expect(environment.CARGO_TARGET_DIR).toBe("/target");
  expect(environment.WISP_WINDOW_SOURCE).toBe("hash");
});
