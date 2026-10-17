import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentSocket, clientName, pairDirectory } from "../../../host/lan/pool";

const pair = Number(process.argv[process.argv.indexOf("--pair") + 1]);
const clients = ["a", "b"].map((side) => ({ name: clientName(pair, side as "a" | "b"), child: spawn("sleep", ["600"], { detached: true, stdio: "ignore" }) }));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  for (const { child } of clients) child.kill("SIGTERM");
  process.exit(143);
});
const runs = Object.fromEntries(["a", "b"].map((side) => {
  const run = join(process.env["WISP_TEST_DESKTOPS"] ?? "", `private-desktop.${side}`);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "lifecycle-owned"), "");
  writeFileSync(join(run, "active"), "");
  return [side, run];
}));
mkdirSync(pairDirectory(pair), { recursive: true });
rmSync(agentSocket(pair), { force: true });
Bun.serve({ unix: agentSocket(pair), fetch: () => Response.json({ pair, clients: clients.map(({ name, child }) => ({ name, pid: child.pid })) }) });
writeFileSync(join(pairDirectory(pair), "agent.json"), JSON.stringify({ pid: process.pid, runs }));
