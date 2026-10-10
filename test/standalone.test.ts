import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { installHeadless } from "../scripts/wisp/headless";
import { openStandalone, type StandaloneGame, type StandaloneOptions } from "../scripts/wisp/standalone";

test("[spec docs/play.md] standalone records scripted checksums and skips live, networked or explicitly disabled checksums", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wisp-checksums-"));
  try {
    const script = join(directory, "input.pad");
    await Bun.write(script, "script fixture");
    const cases: readonly [StandaloneOptions, number, boolean?][] = [[{}, 0], [{ script }, 3], [{ script, recordChecksums: false }, 0], [{ script }, 0, true]];
    for (const [index, [options, expected, paced]] of cases.entries()) {
      let checksumCalls = 0;
      const runtime = installHeadless({ filePrefix: "checksum-fixture", globalPrefixes: [] });
      const clients = runtime.clients({ install() {}, start() {} }, [0]);
      clients.start();
      const game: StandaloneGame = {
        title: "Checksum fixture", render: { readAsset: async () => undefined },
        create: async () => ({
          client: clients.client(0), step: () => clients.frames(1), ...(paced === true ? { paced: true } : {}),
          checksum: () => { checksumCalls++; return "fixture"; }, close: () => runtime.restore(),
        }),
      };
      const out = join(directory, String(index));
      await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
        const player = yield* openStandalone(game, { ...options, out });
        yield* Effect.promise(async () => {
          const prepared = await fetch(`${player.url}prepare`).then(response => response.json());
          expect(prepared.step).toBe(0);
          expect(prepared.scene.frame).toBe(clients.client(0).frame);
          expect(checksumCalls).toBe(0);
          const socket = new WebSocket(`${player.url.replace("http", "ws")}frames`);
          await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
          for (let frame = 0; frame < 3; frame++) {
            const reply = new Promise<string>((resolve) => socket.addEventListener("message", (event) => resolve(String(event.data)), { once: true }));
            socket.send(JSON.stringify({ buttons: [], axisX: 0, axisY: 0 }));
            const packet = JSON.parse(await reply);
            expect(packet.error).toBeUndefined();
            expect(packet.checksum).toBe(expected === 0 ? undefined : "fixture");
          }
          socket.close();
          await fetch(`${player.url}complete`, { method: "POST", body: "{}" });
        });
        yield* player.completed;
        expect(checksumCalls).toBe(expected);
        const rows = Bun.file(join(out, "checksums.jsonl"));
        expect(yield* Effect.promise(() => rows.exists())).toBe(expected !== 0);
        if (expected !== 0) expect((yield* Effect.promise(() => rows.text())).trim().split("\n")).toHaveLength(expected);
      })));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("[spec docs/play.md] standalone replies with a thrown game error's text instead of dropping the frame (wisp#62)", async () => {
  const runtime = installHeadless({ filePrefix: "throw-fixture", globalPrefixes: [] });
  try {
    const clients = runtime.clients({ install() {}, start() {} }, [0]);
    clients.start();
    const game: StandaloneGame = {
      title: "Throw fixture", render: { readAsset: async () => undefined },
      create: async () => ({ client: clients.client(0), step: () => { throw new Error("scripted game failure"); }, checksum: () => "fixture", close() {} }),
    };
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const player = yield* openStandalone(game);
      const packet = yield* Effect.promise(async () => {
        const socket = new WebSocket(`${player.url.replace("http", "ws")}frames`);
        await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
        const reply = new Promise<string>((resolve) => socket.addEventListener("message", (event) => resolve(String(event.data)), { once: true }));
        socket.send(JSON.stringify({ buttons: [], axisX: 0, axisY: 0 }));
        const timeout = new Promise<string>((resolve) => setTimeout(() => resolve('{"error":"no reply"}'), 1000));
        const text = await Promise.race([reply, timeout]);
        socket.close();
        return JSON.parse(text);
      });
      expect(packet).toEqual({ error: "scripted game failure" });
    })));
  } finally { runtime.restore(); }
});
