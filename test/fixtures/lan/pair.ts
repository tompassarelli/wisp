import { nativeCommand } from "../../../scripts/wisp/lan/admission";
import { agentSocket, pairDirectory, writeJson } from "../../../scripts/wisp/lan/pool";
import { join } from "node:path";

const args = process.argv.slice(2);
const at = (name: string) => args[args.indexOf(`--${name}`) + 1];
const pair = Number(at("pair"));
const capacity = at("capacity");
if (capacity === undefined) throw new Error("capacity was not passed to the pair");
const games: Bun.Subprocess[] = [];
for (const side of ["a", "b"]) {
  const game = Bun.spawn([...nativeCommand(capacity, `lan${pair}${side}`, "/tmp"), process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdout: "ignore", stderr: "inherit" });
  games.push(game);
  await Bun.sleep(100);
  if (game.exitCode !== null) throw new Error("client failed");
}
const server = Bun.serve({ unix: agentSocket(pair), fetch: () => Response.json({ clients: games.map((game, index) => ({ name: `lan${pair}${index === 0 ? "a" : "b"}`, pid: game.pid })) }) });
writeJson(join(pairDirectory(pair), "agent.json"), { runs: { a: "test-a", b: "test-b" } });
process.on("SIGTERM", async () => {
  for (const game of games) game.kill("SIGTERM");
  server.stop(true);
  await Promise.all(games.map((game) => game.exited));
  process.exit(0);
});
