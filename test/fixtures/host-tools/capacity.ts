import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [verb, ...rest] = process.argv.slice(2);
if (verb === "probe") {
  console.log(JSON.stringify({ decision: "RUN", reason: "OK", protectedCpuSomeAvg10: 0 }));
  process.exit(0);
}
const command = rest.slice(rest.indexOf("--") + 1);
const sessions = process.env["WISP_TEST_SESSIONS"] ?? "";
mkdirSync(sessions, { recursive: true });
const record = join(sessions, `${process.pid}.json`);
writeFileSync(record, JSON.stringify({ owner: rest[rest.indexOf("--owner") + 1] }));
const scope = `WISP_TEST_SCOPE=${process.pid}`;
const child = spawn(command[0] ?? "", command.slice(1), { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, WISP_TEST_SCOPE: String(process.pid) } });
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
child.on("exit", (code) => {
  rmSync(record, { force: true });
  process.exit(code ?? 1);
});
