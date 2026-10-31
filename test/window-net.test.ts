import { expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import type { HeadlessClient } from "../src/headless/client";
import type { LockstepLink } from "../src/headless/lockstep";
import type { NetReport } from "../host/net/peer";
import type { StandaloneGame, StandaloneInput, StandaloneNetSession, StandaloneSession } from "../host/play/standalone";
import { openNetMatch } from "../host/play/standaloneNet";
import type { InputSample, WindowEvent, WindowView } from "../host/window/binding";
import { type FrameLoop, serveFrames } from "../host/window/frameLoop";

const FRAMES = 120;

/** A slot that sends its window's attack button as a key event each frame and folds every slot's events into its checksum, so equal checksums mean each side ran the other's presses on the same frames. */
const keySession = (link: LockstepLink, slot: number): StandaloneNetSession => {
  let frame = 0, fold = 0, latest: StandaloneInput = { buttons: [], axisX: 0, axisY: 0 };
  return {
    client: {} as HeadlessClient,
    input: (input) => { latest = input; },
    start: () => {},
    step: () => {
      link.sent(frame + link.delay + 1, { sender: slot, kind: "key", key: 65, meta: 0, down: latest.buttons.includes("attack") });
      frame++;
      for (const event of link.due(frame)) if (event.kind === "key") fold = (Math.imul(fold, 31) + (event.down ? 2 : 1) + event.sender * 7 + frame) | 0;
    },
    frame: () => frame,
    checksum: () => String(fold),
    close: () => {},
  };
};

const game: StandaloneGame = {
  title: "Window net fixture", render: { readAsset: async () => undefined },
  create: () => Promise.reject(new Error("a networked fixture makes no offline session")),
  net: { mapHash: async () => "0123abcd".repeat(8), create: async (link, slot) => keySession(link, slot) },
};

/** A window whose render thread queues a sample every 16 ms and records each wait it was asked for; it reports stopped once `stop` is set. */
const fakeWindow = () => {
  const waits: number[] = [];
  let last = performance.now(), frame = 0;
  const state = { stop: false };
  const view = {
    nextEvent: (timeoutMs: number): WindowEvent => {
      waits.push(timeoutMs);
      if (state.stop) return { kind: "stopped" };
      if (performance.now() - last < 16) return { kind: "timeout" };
      last = performance.now();
      return { kind: "frame", sample: { frame: frame++, sampleNs: 0, mask: 0, keys: [], axisX: 0, axisY: 0 } as unknown as InputSample };
    },
    error: () => undefined,
  } as unknown as WindowView;
  return { view, waits, state };
};

/** The worker's loop for one side: each sample hands the window's input to the paced session, pressing attack on every third. */
const sideOf = (session: StandaloneSession): FrameLoop => ({
  series: { wakes: [], steps: [], encodes: [], frames: [], intervals: [], stages: {} },
  step: (sample) => session.step({ buttons: sample.frame % 3 === 0 ? ["attack"] : [], axisX: 0, axisY: 0 }),
  complete: () => {},
  dispose: () => {},
});

const freePort = async () => {
  const probe = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
  const { port } = probe;
  probe.close();
  return port;
};

test("[spec docs/native-window-plan.md] a host and a joiner on the window path play a match over UDP with equal checksums, each window's presses reaching the other, and the window's loop never blocks the peer's thread", async () => {
  const port = await freePort();
  const play = (net: Parameters<typeof openNetMatch>[2]) => Effect.gen(function*() {
    const match = yield* openNetMatch(game, { frames: FRAMES }, net);
    const session = yield* Effect.promise(() => match.game.create());
    expect(session.paced).toBe(true);
    const window = fakeWindow();
    const serving = yield* Effect.forkScoped(serveFrames(window.view, sideOf(session), Promise.resolve(), true));
    const report: NetReport | void = yield* match.ended;
    window.state.stop = true;
    expect(yield* Fiber.join(serving)).toBe("ended");
    expect(new Set(window.waits)).toEqual(new Set([0]));
    return { report, checksum: session.checksum() };
  });
  const [host, joiner] = await Effect.runPromise(Effect.scoped(Effect.all([
    play({ host: { port } }),
    Effect.sleep(50).pipe(Effect.andThen(play({ join: `127.0.0.1:${port}` }))),
  ], { concurrency: "unbounded" })));
  for (const side of [host, joiner]) {
    expect(side.report?.frames).toBe(FRAMES);
    expect(side.report?.mismatches).toBe(0);
    expect(side.report?.checksumsCompared).toBeGreaterThanOrEqual(1);
  }
  expect(host.checksum).toBe(joiner.checksum);
  expect(host.checksum).not.toBe("0");
}, 20_000);
