import { expect, test } from "bun:test";
import { Console, Effect } from "effect";
import { emitJson } from "../scripts/wisp/jsonResults";

test("JSON failures retain a TypeScript throw site when their message names one", () => {
  const lines: string[] = [];
  const emit = (result: Readonly<Record<string, unknown>>) => Effect.runSync(emitJson("headless", result).pipe(
    Effect.provideService(Console.Console, { ...console, log: (line: string) => lines.push(line) }),
  ));
  emit({ type: "failure", message: "Error: boom\n    at frame (src/map.ts:42:9)" });
  emit({ type: "result", ok: false, message: "error in src/map.ts:42" });
  emit({ type: "failure", message: "native calls differ" });
  emit({ type: "failure", message: "src/map.ts:42", source: "src/throw.ts:12" });
  const rows = lines.map((line) => JSON.parse(line));
  expect(rows[0].source).toBe("src/map.ts:42");
  expect(rows[1].source).toBe("src/map.ts:42");
  expect(rows[2]).not.toHaveProperty("source");
  expect(rows[3].source).toBe("src/throw.ts:12");
});
