import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { mapReuseKey, pruneReuseStore, reuseOrBuild } from "../host/compile/mapReuse";

const scratch = () => mkdtempSync(join(tmpdir(), "wisp-map-reuse-"));

test("[scenario] two builds of one key run the build once, the second reuses the first's map and logs the reused hash", async () => {
  const store = join(scratch(), "store"), work = scratch();
  const key = mapReuseKey({ tree: "abc", profile: "playable", edition: "classic" });
  let builds = 0;
  const request = (name: string) => {
    const out = join(work, `${name}.w3x`);
    const build = Effect.promise(async () => {
      builds += 1;
      await Bun.sleep(300);
      writeFileSync(out, `map ${builds}`);
      writeFileSync(`${out}.base.lua`, "base");
    });
    return { out, run: reuseOrBuild({ key, out, build, store }) };
  };
  const logged: string[] = [];
  const log = console.log;
  console.log = (line: unknown) => { logged.push(String(line)); };
  try {
    const [first, second] = [request("first"), request("second")];
    const results = await Promise.all([Effect.runPromise(first.run), Effect.runPromise(second.run)]);
    expect(builds).toBe(1);
    expect(results.map(({ reused }) => reused).sort()).toEqual([false, true]);
    expect(readFileSync(first.out, "utf8")).toBe("map 1");
    expect(readFileSync(second.out, "utf8")).toBe("map 1");
    expect(readFileSync(`${second.out}.base.lua`, "utf8")).toBe("base");
    expect(logged).toContain(`reused map build ${key}`);
  } finally {
    console.log = log;
  }
});

test("[property] a key changes with any input and does not depend on input order", () => {
  const base = { tree: "abc", lock: "x", profile: "playable", edition: "classic" };
  expect(mapReuseKey(base)).toBe(mapReuseKey({ edition: "classic", profile: "playable", lock: "x", tree: "abc" }));
  for (const label of Object.keys(base)) expect(mapReuseKey({ ...base, [label]: "other" })).not.toBe(mapReuseKey(base));
  expect(mapReuseKey({ a: "b", c: "" })).not.toBe(mapReuseKey({ a: "", c: "b" }));
});

test("[scenario] a store past its cap drops the least recently used builds first and keeps the one just stored", () => {
  const store = join(scratch(), "store");
  const keys = ["1", "2", "3"].map((seed) => mapReuseKey({ seed }));
  keys.forEach((key, index) => {
    mkdirSync(join(store, key), { recursive: true });
    writeFileSync(join(store, key, "map.w3x"), "x".repeat(100));
    const at = new Date(2026, 9, 1 + index);
    utimesSync(join(store, key), at, at);
  });
  const [oldest = "", middle = "", newest = ""] = keys;
  expect(pruneReuseStore(store, 250, newest)).toEqual([oldest]);
  expect(existsSync(join(store, oldest))).toBe(false);
  expect(existsSync(join(store, middle))).toBe(true);
  expect(pruneReuseStore(store, 1, oldest)).toEqual([middle, newest]);
});
