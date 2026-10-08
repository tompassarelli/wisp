// Putting one offline client into a LAN game (wisp:docs/lan.md): switch its
// provider to TCPN for one rebuild (provider.ts), then list LAN games through
// its menus and join the one named. The switch lasts until the provider is
// rebuilt again (leaving a LAN lobby or game does that), so it runs before
// every join.
import { readFileSync } from "node:fs";
import { Effect, Schedule, Schema } from "effect";
import type { MenuSocket } from "../menus";
import { isolatedNetworkProblem } from "./offline";
export class LanFailure extends Schema.TaggedError<LanFailure>()("LanFailure", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

const fail = (problem: string) => Effect.fail(new LanFailure({ problem }));
const attempt = <A>(what: string, run: () => A) => Effect.try({ try: run, catch: (cause) => new LanFailure({ problem: `${what}: ${cause instanceof Error ? cause.message : String(cause)}` }) });

export interface Switch {
  readonly address: number;
  readonly before: string;
  readonly after: string;
}

interface ListedGame {
  readonly id: number;
  readonly name: string;
  readonly mapFile?: string;
}

const listedGames = (payload: unknown): ListedGame[] => {
  const games = typeof payload === "object" && payload !== null ? (payload as { games?: unknown }).games : undefined;
  return Array.isArray(games) ? games.filter((game): game is ListedGame => typeof game === "object" && game !== null && typeof (game as ListedGame).name === "string") : [];
};

/** Lists LAN games every second until `gameName` appears, then joins it. */
export const joinLanGame = (menus: MenuSocket, gameName: string, seconds = 30) => Effect.gen(function*() {
  yield* menus.forget;
  yield* menus.send("SendGameListing");
  const listed = Effect.gen(function*() {
    yield* menus.send("GetGameList");
    const games = yield* menus.expect("list LAN games", 3, (event) => (event.messageType === "GameList" ? { done: listedGames(event.payload) } : undefined)).pipe(Effect.orElseSucceed((): ListedGame[] => []));
    return games.find(({ name }) => name === gameName);
  });
  const game = yield* listed.pipe(
    Effect.repeat({ schedule: Schedule.spaced("1 second"), until: (found) => found !== undefined }),
    Effect.timeoutOrElse({ duration: `${seconds} seconds`, orElse: () => fail(`no LAN game named ${gameName} listed within ${seconds} s`) }),
  );
  if (game !== undefined) yield* menus.send("JoinGame", { gameId: game.id, password: "", mapFile: game.mapFile });
}).pipe(Effect.mapError((failure) => (failure instanceof LanFailure ? failure : new LanFailure({ problem: failure.message }))));
