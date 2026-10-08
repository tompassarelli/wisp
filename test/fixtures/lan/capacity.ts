import { appendFileSync, existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const at = (name: string) => args[args.indexOf(`--${name}`) + 1];
const log = process.env["WISP_ADMISSION_LOG"] ?? "";
const launched = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
if (args[0] === "probe") {
  const deferred = launched.length >= 2;
  console.log(JSON.stringify({ decision: deferred ? "DEFER" : "RUN", reason: deferred ? "DEFER_NATIVE_CPUS" : "RUN", protectedCpuSomeAvg10: Number(process.env["WISP_ADMISSION_PRESSURE"] ?? "0"), profile: "unattended" }));
  process.exit(deferred ? 75 : 0);
}
if (args[0] !== "session") throw new Error("expected session");
if (at("owner")?.startsWith("wisp-lan-pair-") === true) {
  if (at("class") !== "native") throw new Error("a pair's desktops must use a native scope");
  const command = args.slice(args.indexOf("--") + 1);
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/pair.ts`, ...command.slice(2)], { stdout: "inherit", stderr: "inherit" });
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.exit(await child.exited);
}
if (at("class") !== "native" || at("memory-gib") !== "1.5") throw new Error("every client must use its native scope");
appendFileSync(log, `${at("owner")}\n`);
const child = Bun.spawn(args.slice(args.indexOf("--") + 1), { stdout: "inherit", stderr: "inherit" });
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.exit(await child.exited);
