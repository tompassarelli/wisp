import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentSocket, clientName, pairDirectory } from "../../../scripts/wisp/lan/pool";

const pair = Number(process.argv[process.argv.indexOf("--pair") + 1]);
const clients = ["a", "b"].map((side) => ({ name: clientName(pair, side as "a" | "b"), child: Bun.spawn(["sleep", "600"], { stdio: ["ignore", "ignore", "ignore"] }) }));
const runs = Object.fromEntries(["a", "b"].map((side) => {
  const run = join(process.env["WISP_TEST_DESKTOPS"] ?? "", `private-desktop.${side}`);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "lifecycle-owned"), "");
  writeFileSync(join(run, "active"), "");
  return [side, run];
}));
mkdirSync(pairDirectory(pair), { recursive: true });
await Bun.sleep(Number(process.env["WISP_TEST_READY_MS"] ?? "0"));
rmSync(agentSocket(pair), { force: true });
Bun.serve({ unix: agentSocket(pair), fetch: () => Response.json({ pair, clients: clients.map(({ name, child }) => ({ name, pid: child.pid })) }) });
writeFileSync(join(pairDirectory(pair), "agent.json"), process.env["WISP_TEST_BAD_AGENT"] === undefined ? JSON.stringify({ pid: process.pid, runs }) : "{");
