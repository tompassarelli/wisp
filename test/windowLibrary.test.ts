import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
