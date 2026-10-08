// A stand-in for lan/pairSession.ts in host-tools tests: two `sleep 600`
// clients and a pair agent socket that reports their pids after
// WISP_TEST_READY_MS; agent.json is unreadable when WISP_TEST_BAD_AGENT is set.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentSocket, clientName, pairDirectory } from "../../../scripts/wisp/lan/pool";

const pair = Number(process.argv[process.argv.indexOf("--pair") + 1]);
const clients = ["a", "b"].map((side) => ({ name: clientName(pair, side as "a" | "b"), child: Bun.spawn(["sleep", "600"], { stdio: ["ignore", "ignore", "ignore"] }) }));
mkdirSync(pairDirectory(pair), { recursive: true });
await Bun.sleep(Number(process.env["WISP_TEST_READY_MS"] ?? "0"));
rmSync(agentSocket(pair), { force: true });
Bun.serve({ unix: agentSocket(pair), fetch: () => Response.json({ pair, clients: clients.map(({ name, child }) => ({ name, pid: child.pid })) }) });
writeFileSync(join(pairDirectory(pair), "agent.json"), process.env["WISP_TEST_BAD_AGENT"] === undefined ? JSON.stringify({ pid: process.pid, runs: {} }) : "{");
