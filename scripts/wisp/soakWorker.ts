import { installHeadless } from "./headless";
import { playSoakMatch } from "./soak";
import { loadSoakGame, loadSoakProject, readSoakMatch, soakReply } from "./soak/file";

const [path] = process.argv.slice(2);
if (path === undefined) throw new Error("usage: bun soakWorker.ts SOAK_MODULE");
const project = await loadSoakProject(path);
const game = await loadSoakGame(project.game);
const runtime = installHeadless(project.map);
for await (const line of console) {
  if (line.trim() === "") continue;
  const result = playSoakMatch(runtime, game, project, readSoakMatch(line));
  const { user, system } = process.cpuUsage();
  process.stdout.write(`${JSON.stringify(soakReply(result, (user + system) / 1000))}\n`);
}
runtime.restore();
