import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cachedWindowLibrary } from "../host/window/library";

test("[spec docs/native-window-plan.md] a library built from a package's window source is cached under a hash of that source", () => {
  const folder = mkdtempSync(join(tmpdir(), "window-library-"));
  try {
    cpSync(join(import.meta.dir, "../window/Cargo.toml"), join(folder, "Cargo.toml"));
    const first = cachedWindowLibrary(folder, "libwisp_window.so");
    expect(cachedWindowLibrary(folder, "libwisp_window.so")).toBe(first);
    expect(first.endsWith(join("release", "libwisp_window.so"))).toBe(true);
    writeFileSync(join(folder, "Cargo.lock"), "changed");
    expect(cachedWindowLibrary(folder, "libwisp_window.so")).not.toBe(first);
  } finally {
    rmSync(folder, { recursive: true });
  }
});

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
