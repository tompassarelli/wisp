import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import type { LanPlugin, PoolLaunch } from "../host/lan/plugin";
import { installOf, launchEnvironment, prefixOf } from "../host/lan/pool";

const plugin = (seen: PoolLaunch[]): LanPlugin => ({
  version: () => "0.0.0.0",
  enableLan: () => Effect.void,
  launchEnvironment: (client) => Effect.sync(() => {
    seen.push(client);
    return { PLUGIN_ADDED: client.offline ? "offline" : "networked" };
  }),
});

describe("pool launch environment", () => {
  test("[spec docs/lan.md] a pool client's launch carries the private plugin's environment for that client's own prefix, install and offline state, and nothing without a plugin", async () => {
    const seen: PoolLaunch[] = [];
    const run = (name: string, network: boolean, loaded: Option.Option<LanPlugin>) => Effect.runPromise(Effect.scoped(launchEnvironment(name, network, Effect.succeed(loaded))));
    expect(await run("lan3a", false, Option.some(plugin(seen)))).toEqual({ PLUGIN_ADDED: "offline" });
    expect(await run("lan4a", true, Option.some(plugin(seen)))).toEqual({ PLUGIN_ADDED: "networked" });
    expect(seen).toEqual([
      { name: "lan3a", prefix: prefixOf("lan3a"), install: installOf("lan3a"), offline: true },
      { name: "lan4a", prefix: prefixOf("lan4a"), install: installOf("lan4a"), offline: false },
    ]);
    expect(await run("lan3a", false, Option.none())).toEqual({});
  });
});
