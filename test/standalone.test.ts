import { expect, test } from "bun:test";
import { Effect } from "effect";
import { installHeadless } from "../host/headless/headless";
import { openStandalone, type StandaloneGame } from "../host/play/standalone";
import { screenHeight, screenWidth } from "../src/game/native/frames";
import { bindWorld } from "../src/game/native/world";

test("[spec docs/native-window-plan.md] the local client reports the window's size as its screen, follows a resize, and keeps the last size while the window has no area", async () => {
  const runtime = installHeadless({ filePrefix: "screen-fixture", globalPrefixes: [] });
  const clients = runtime.clients({ install() {}, start() {} }, [0]);
  clients.start();
  const client = clients.client(0);
  const game: StandaloneGame = {
    title: "Screen fixture", render: { readAsset: async () => undefined },
    create: async () => ({ client, step: () => clients.frames(1), checksum: () => client.checksum(), close: () => runtime.restore() }),
  };
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const player = yield* openStandalone(game);
    const reported = (screen?: { readonly width: number; readonly height: number }) => {
      player.native.advance({ buttons: [], axisX: 0, axisY: 0, ...(screen === undefined ? {} : { screen }) });
      bindWorld(client.world);
      try {
        return [screenWidth(), screenHeight(), client.screen.width];
      } finally {
        bindWorld(undefined);
      }
    };
    expect(reported({ width: 1280, height: 960 })).toEqual([1280, 960, 1280]);
    expect(reported({ width: 1600, height: 900 })).toEqual([1600, 900, 1600]);
    expect(reported({ width: 0, height: 0 })).toEqual([1600, 900, 1600]);
    expect(reported()).toEqual([1600, 900, 1600]);
  })));
});
