



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
const pairSession = command.findIndex((arg) => arg.endsWith("pairSession.ts"));
const standIn = pairSession >= 0 ? [process.execPath, join(import.meta.dir, "pairSession.ts"), ...command.slice(pairSession + 1)] : ["sh", "-c", "sleep 600 & sleep 600 & wait"];
const child = spawn(standIn[0] ?? "", standIn.slice(1), { detached: true, stdio: ["ignore", "inherit", "inherit"] });
const stop = () => {
  try {
    process.kill(-(child.pid ?? 0), "SIGTERM");
  } catch {}
  rmSync(record, { force: true });
  process.exit(143);
};
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(signal, stop);
child.on("exit", (code) => {
  rmSync(record, { force: true });
  process.exit(code ?? 1);
});
