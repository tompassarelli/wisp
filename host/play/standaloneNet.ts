import { networkInterfaces } from "node:os";
import { Effect, Fiber, Schema } from "effect";
import { joinCode, joinTarget, relayCode, relayRegions, CODE_HASH_DIGITS, type RelayChoice } from "../net/joinCode";
import { chooseHostRelay, showJoinPing } from "../net/regionChoice";
import { NetFailure } from "../net/failure";
import { type NetListening, type NetRole, runNetPeer } from "../net/peer";
import { RenderFailure } from "../render/headlessRender";
import type { StandaloneGame, StandaloneNet, StandaloneNetSession } from "./standaloneGame";

class MapMismatch extends Schema.TaggedError<MapMismatch, { readonly brand: unique symbol }>()("MapMismatch", { code: Schema.String, here: Schema.String }) {
  override get message(): string {
    return `the join code is for map ${this.code}, this build is map ${this.here.slice(0, CODE_HASH_DIGITS)}; both players need the same build`;
  }
}

/** This machine's IPv4 addresses other players can reach, LAN ones first. */
function reachableAddresses(): string[] {
  return Object.values(networkInterfaces()).flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal).map((entry) => entry.address);
}

const FOREVER_FRAMES = 60 * 60 * 60 * 24;

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (cause) => new RenderFailure({ cause }) });

interface Reach { readonly role: NetRole; readonly relay?: RelayChoice }

const reachOf = (net: StandaloneNet, mapHash: string) => Effect.gen(function*() {
  if ("host" in net) {
    if (net.host.relay === undefined) return { role: { kind: "host", port: net.host.port } } satisfies Reach;
    const relay = yield* chooseHostRelay(net.host.relay, relayRegions(), console.error);
    return { role: { kind: "relayHost", relay: relay.relay }, relay } satisfies Reach;
  }
  const target = joinTarget(net.join);
  if (typeof target === "string") return yield* new NetFailure({ problem: target });
  if ("relay" in target) {
    yield* showJoinPing(target.relay, relayRegions(), console.error);
    return { role: { kind: "relayJoin", relay: target.relay, room: target.room } } satisfies Reach;
  }
  if (target.mapHash !== undefined && target.mapHash !== mapHash.slice(0, CODE_HASH_DIGITS)) return yield* new MapMismatch({ code: target.mapHash, here: mapHash });
  return { role: { kind: "join", to: { address: target.address, port: target.port } } } satisfies Reach;
});

/**
 * One player of a networked match, on whichever thread steps the game (the Chrome page's Bun thread or the native window's worker):
 * `--host` listens (or, with `--relay REGION`, opens a relay room) and prints the join code, `--join CODE|ADDRESS:PORT` joins it
 * (wisp:docs/play.md). The peer runs in the caller's scope; the game it returns makes the paced session once the match starts, or
 * fails with the peer's error, and `ended` is the peer's report or the error that ended it.
 */
export const openNetMatch = (game: StandaloneGame, options: { readonly script?: string | undefined; readonly frames?: number | undefined }, net: StandaloneNet) => Effect.gen(function*() {
  const hooks = game.net;
  if (hooks === undefined) return yield* new NetFailure({ problem: `${game.title} doesn't support host and join` });
  const mapHash = yield* attempt(() => hooks.mapHash());
  const { role, relay }: Reach = yield* reachOf(net, mapHash);
  const script = options.script === undefined ? undefined : yield* attempt(() => Bun.file(options.script!).text());
  const created = Promise.withResolvers<StandaloneNetSession>();
  void created.promise.catch(() => undefined);
  const listening = (at: NetListening) => {
    if ("room" in at) {
      if (relay !== undefined) console.log(`${game.title}: join code ${relayCode(relay, at.room)} (relay room; the joiner's map must match ${mapHash.slice(0, CODE_HASH_DIGITS)})`);
      return;
    }
    const { port } = at;
    const addresses = reachableAddresses();
    const [lan] = addresses;
    if (lan !== undefined) console.log(`${game.title}: join code ${joinCode(lan, port, mapHash)} (map ${mapHash.slice(0, CODE_HASH_DIGITS)})`);
    for (const address of addresses) console.log(`${game.title}: direct address ${address}:${port} (UDP; forward this port to ${address} for a player outside this network)`);
    if (lan === undefined) console.log(`${game.title}: no network address; on this machine join 127.0.0.1:${port}`);
  };
  const peer = yield* Effect.forkScoped(runNetPeer({
    create: async (link, slot, humans) => {
      const session = await hooks.create(link, slot, humans, script === undefined ? undefined : { script });
      return { ...session, start: () => { session.start(); created.resolve(session); }, close: () => undefined };
    },
  }, { role, game: `${game.title} map ${mapHash}`, frames: options.frames ?? FOREVER_FRAMES, listening }).pipe(Effect.tapError((error) => Effect.sync(() => created.reject(error)))));
  const paced: StandaloneGame = {
    ...game,
    create: async () => {
      const session = await created.promise;
      return { client: session.client, paced: true, step: session.input, checksum: session.checksum, frame: session.frame, ...(session.finished === undefined ? {} : { finished: session.finished }), ...(session.stages === undefined ? {} : { stages: session.stages }), close: session.close };
    },
  };
  return { game: paced, ended: Fiber.join(peer).pipe(Effect.tap((report) => Effect.sync(() => console.error(`net: ${JSON.stringify(report)}`)))) };
});
