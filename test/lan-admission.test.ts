import { expect, test } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

test("[spec docs/lan.md] direct pair entry points refuse a missing capacity helper before launch", async () => {
  for (const script of ["pairSession", "pairAgent"]) {
    const child = Bun.spawn([process.execPath, join(root, `scripts/wisp/lan/${script}.ts`)], { stdout: "pipe", stderr: "pipe" });
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(code).not.toBe(0);
    expect(stderr).toContain(`${script} requires --capacity`);
  }
});
