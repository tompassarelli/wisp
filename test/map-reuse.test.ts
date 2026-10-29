import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { mapReuseKey, pruneReuseStore, reuseCapBytes, reuseOrBuild } from "../host/compile/mapReuse";

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

test("[scenario] a build stored on a peer host is copied over the peer's shell under the same key and reused, and an unreachable peer leaves the build to run here", async () => {
  const peerStore = join(scratch(), "peer"), store = join(scratch(), "store"), work = scratch();
  const key = mapReuseKey({ tree: "peer", profile: "native-capture" });
  let builds = 0;
  const build = (out: string) => Effect.sync(() => {
    builds += 1;
    writeFileSync(out, `map ${builds}`);
    writeFileSync(`${out}.base.lua`, "base");
  });
  const viaPeerShell = () => ["env", `WISP_MAP_REUSE_STORE=${peerStore}`, "sh", "-c"];
  const logged: string[] = [];
  const log = console.log;
  console.log = (line: unknown) => { logged.push(String(line)); };
  try {
    const built = join(work, "peer.w3x"), copied = join(work, "here.w3x"), unreachable = join(work, "alone.w3x");
    await Effect.runPromise(reuseOrBuild({ key, out: built, build: build(built), store: peerStore, peers: [] }));
    expect(await Effect.runPromise(reuseOrBuild({ key, out: copied, build: build(copied), store, peers: ["laptop"], remote: viaPeerShell }))).toEqual({ reused: true, key });
    expect(builds).toBe(1);
    expect(readFileSync(copied, "utf8")).toBe("map 1");
    expect(readFileSync(`${copied}.base.lua`, "utf8")).toBe("base");
    expect(existsSync(join(store, key, "map.w3x"))).toBe(true);
    expect(logged).toEqual(expect.arrayContaining([`copied map build ${key} from laptop`, `reused map build ${key}`]));
    const other = mapReuseKey({ tree: "only here" });
    expect(await Effect.runPromise(reuseOrBuild({ key: other, out: unreachable, build: build(unreachable), store, peers: ["laptop"], remote: () => ["false"] }))).toEqual({ reused: false, key: other });
    expect(builds).toBe(2);
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

test("[scenario] the store's cap is the env override, else the host's map_store share, else 8 GiB", () => {
  const saved = process.env.WISP_MAP_REUSE_GIB;
  try {
    delete process.env.WISP_MAP_REUSE_GIB;
    expect(reuseCapBytes(() => "6.5")).toBe(6.5 * 2 ** 30);
    expect(reuseCapBytes(() => undefined)).toBe(8 * 2 ** 30);
    expect(reuseCapBytes(() => "")).toBe(8 * 2 ** 30);
    process.env.WISP_MAP_REUSE_GIB = "2";
    expect(reuseCapBytes(() => "6.5")).toBe(2 * 2 ** 30);
  } finally {
    if (saved === undefined) delete process.env.WISP_MAP_REUSE_GIB;
    else process.env.WISP_MAP_REUSE_GIB = saved;
  }
});
