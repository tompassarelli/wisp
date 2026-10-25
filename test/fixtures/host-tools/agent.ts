import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentPidFile, agentSocket, clientLog, clientName, pairDirectory } from "../../../host/lan/pool";

const pair = Number(process.argv[process.argv.indexOf("--pair") + 1]);
const clients: { name: string; child: ReturnType<typeof spawn> }[] = [];
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => setTimeout(() => {
  for (const { child } of clients) child.kill("SIGTERM");
  process.exit(143);
}, 1000));
mkdirSync(pairDirectory(pair), { recursive: true });
writeFileSync(agentPidFile(pair), `${process.pid}\n`);
clients.push(...["a", "b"].map((side) => {
  const name = clientName(pair, side as "a" | "b");
  const lease = crypto.randomUUID();
  writeFileSync(clientLog(pair, name), `${JSON.stringify({ decision: "RESERVED", lease })}\n`);
  return { name, child: spawn("sleep", ["600"], { detached: true, stdio: "ignore", env: { ...process.env, WISP_TEST_LEASE: lease.replaceAll("-", "") } }) };
}));
const runs = Object.fromEntries(["a", "b"].map((side) => {
  const run = join(process.env["WISP_TEST_DESKTOPS"] ?? "", `private-desktop.${side}`);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "lifecycle-owned"), "");
  writeFileSync(join(run, "active"), "");
  return [side, run];
}));
const die = process.env["WISP_TEST_AGENT_DIE"];
for (const ready = Date.now() + Number(process.env["WISP_TEST_AGENT_READY_MS"] ?? 0); Date.now() < ready; await Bun.sleep(100)) {
  if (die !== undefined && existsSync(die)) process.kill(process.pid, "SIGKILL");
}
rmSync(agentSocket(pair), { force: true });
Bun.serve({ unix: agentSocket(pair), fetch: () => Response.json({ pair, clients: clients.map(({ name, child }) => ({ name, pid: child.pid })) }) });
writeFileSync(join(pairDirectory(pair), "agent.json"), JSON.stringify({ pid: process.pid, runs }));
