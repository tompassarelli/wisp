import { expect, test } from "bun:test";
import { landing } from "../host/checks/autolandLanding";

test("[spec wisp autoland-parallel] a tested branch lands past a moved main only when main's new commits touch none of its paths and no shared input", () => {
  expect(landing("host/a.ts\nsrc/b.ts", "")).toBe("land");
  expect(landing("host/a.ts\nsrc/b.ts", "docs/c.md\nsrc/d.ts")).toBe("land");
  expect(landing("host/a.ts\nsrc/b.ts", "docs/c.md\nsrc/b.ts")).toBe("retest");
  expect(landing("host/a.ts", "bun.lock")).toBe("retest");
  expect(landing("host/a.ts", "window/Cargo.lock")).toBe("retest");
  expect(landing("host/a.ts", ".github/workflows/ci.yml")).toBe("retest");
  expect(landing("", "package.json")).toBe("retest");
});
