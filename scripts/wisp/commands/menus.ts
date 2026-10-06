// `wisp menus ...`: drives Warcraft III's menus without clicks through Wisp's
// menu page (wisp:docs/driving-warcraft.md).
//   install RETAIL_DIR [--port N]   writes the menu page into the game's _retail_ folder
//   remove RETAIL_DIR               removes it
//   listen [--port N]               prints the menus' port and each request the menus send
//   host --folder F --map FILE --name NAME [--password P] [--start] [--port N]
//   join --name NAME --password P [--port N]
//   start [--port N]                starts the hosted lobby
//   leave [--port N]
import { Console, Effect } from "effect";
import { type Command, UsageFailure, flagValues } from "../command";
import { DEFAULT_MENU_REPORT_PORT, type MenuSocket, connectMenus, hostLobby, installMenuPage, joinLobby, leaveLobby, listenForMenus, removeMenuPage, startLobby } from "../menus";
import { step } from "../timings";
import { waitForProcessStop } from "./hot";

/** How long a command waits for the page's next report; it reports every 2 s. */
const ANNOUNCE_SECONDS = 5;

const flag = (args: readonly string[], name: string) => flagValues(args, name)[0];

const reportPort = (args: readonly string[]) => Effect.gen(function*() {
  const text = flag(args, "port") ?? String(DEFAULT_MENU_REPORT_PORT);
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return yield* new UsageFailure({ problem: `--port takes a port number, not ${text}` });
  return port;
});

/** Runs `use` on the menus' socket, found through the page's next report. */
const withMenus = <A, E>(args: readonly string[], use: (menus: MenuSocket) => Effect.Effect<A, E>) => Effect.scoped(Effect.gen(function*() {
  const reports = yield* listenForMenus(yield* reportPort(args));
  const address = yield* reports.waitForAddress(ANNOUNCE_SECONDS).pipe(step("menus found"));
  const menus = yield* connectMenus(address).pipe(step(`menus on 127.0.0.1:${address.port}`));
  return yield* use(menus);
}));

const randomPassword = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => (byte % 36).toString(36)).join("");

export const makeMenus = (): Command => ([action, ...args]) => Effect.gen(function*() {
  switch (action) {
    case "install":
    case "remove": {
      const [retail] = args;
      if (retail === undefined || retail.startsWith("--")) return yield* new UsageFailure({ problem: `${action} takes the game's _retail_ folder` });
      if (action === "remove") {
        const removed = yield* removeMenuPage(retail);
        yield* Console.log(removed ? "menu page removed" : "no menu page installed");
        return;
      }
      yield* Console.log(`menu page installed: ${yield* installMenuPage(retail, yield* reportPort(args))}`);
      return;
    }
    case "listen":
      yield* Effect.scoped(Effect.gen(function*() {
        const reports = yield* listenForMenus(yield* reportPort(args), (sent) => console.log(sent.payload === undefined ? sent.message : `${sent.message} ${JSON.stringify(sent.payload)}`));
        yield* Console.log(`waiting for the menu page on 127.0.0.1:${reports.port}`);
        const address = yield* reports.waitForAddress(3600);
        yield* Console.log(`menus on 127.0.0.1:${address.port}; their requests follow`);
        yield* waitForProcessStop;
      }));
      return;
    case "host": {
      const [folder, file, gameName] = [flag(args, "folder"), flag(args, "map"), flag(args, "name")];
      if (folder === undefined || file === undefined || gameName === undefined) return yield* new UsageFailure({ problem: "host needs --folder, --map and --name" });
      if (args.includes("--password") && flag(args, "password") === undefined) return yield* new UsageFailure({ problem: "--password needs a value; use --password= for a game without a password" });
      const password = flag(args, "password") ?? randomPassword();
      yield* withMenus(args, (menus) => Effect.gen(function*() {
        const map = yield* hostLobby(menus, { folder, file, gameName, password }).pipe(step(`hosting "${gameName}"`));
        yield* Console.log(`hosting "${gameName}" (password ${password}) on ${map}`);
        if (args.includes("--start")) yield* startLobby(menus).pipe(step("loading"));
      }));
      return;
    }
    case "join": {
      const [gameName, password] = [flag(args, "name"), flag(args, "password")];
      if (gameName === undefined || password === undefined) return yield* new UsageFailure({ problem: "join needs --name and --password" });
      yield* withMenus(args, (menus) => joinLobby(menus, gameName, password).pipe(step(`in "${gameName}"`)));
      return;
    }
    case "start":
      yield* withMenus(args, (menus) => startLobby(menus).pipe(step("loading")));
      return;
    case "leave":
      yield* withMenus(args, (menus) => leaveLobby(menus).pipe(step("left the lobby")));
      return;
    default:
      return yield* new UsageFailure({ problem: `unknown menus action ${action ?? ""}`.trim() });
  }
});
