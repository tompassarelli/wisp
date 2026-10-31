import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rest = process.argv.slice(3);
const option = (name: string) => (rest.indexOf(name) >= 0 && rest.indexOf(name) < rest.indexOf("--") ? rest[rest.indexOf(name) + 1] : undefined);
const command = rest.slice(rest.indexOf("--") + 1);
const owner = option("--owner") ?? "";
if (owner.startsWith("wisp-lan-pair-") && option("--new-clients") !== (command.includes("--network") ? "1" : "2")) {
  console.error("a pair session must declare its new clients: two, or one with --network");
  process.exit(64);
}
const queueMs = process.env["WISP_TEST_CAPACITY_QUEUE_MS"];
if (queueMs !== undefined && owner.startsWith("wisp-lan-pair-")) {
  const deferral = { reason: "DEFER_GPU_BUSY", cpuSomeAvg10: 0 };
  if (option("--wait-seconds") === undefined) {
    console.error(JSON.stringify({ decision: "DEFER", ...deferral }));
    process.exit(75);
  }
  console.error(JSON.stringify({ decision: "QUEUED", ...deferral }));
  await Bun.sleep(Number(queueMs));
}
console.error(JSON.stringify({ decision: "RESERVED", reason: "RUN", owner }));
const sessions = process.env["WISP_TEST_SESSIONS"] ?? "";
mkdirSync(sessions, { recursive: true });
const record = join(sessions, `${process.pid}.json`);
const scope = `WISP_TEST_SCOPE=${process.pid}`;
const members = () => readdirSync("/proc").filter((entry) => /^\d+$/.test(entry)).filter((pid) => {
  try {
    return readFileSync(`/proc/${pid}/environ`, "latin1").split("\0").includes(scope);
  } catch {
    return false;
  }
}).map(Number);
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(signal, () => {
  for (const pid of members()) try { process.kill(pid, "SIGTERM"); } catch {}
});
writeFileSync(record, JSON.stringify({ owner: rest[rest.indexOf("--owner") + 1] }));
const child = spawn(command[0] ?? "", command.slice(1), { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, WISP_TEST_SCOPE: String(process.pid) } });
child.on("exit", (code) => {
  rmSync(record, { force: true });
  process.exit(code ?? 1);
});
