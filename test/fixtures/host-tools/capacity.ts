import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
const child = spawn(command[0] ?? "", command.slice(1), { stdio: ["ignore", "inherit", "inherit"] });
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  rmSync(record, { force: true });
  process.exit(code ?? 1);
});
