import { readFileSync, readdirSync } from "node:fs";

const [verb, ...rest] = process.argv.slice(2).filter((arg) => arg !== "--user");
const unit = rest.find((arg) => /^agent-capacity-[0-9a-f]{32}\.scope$/.test(arg));
if (unit === undefined) process.exit(1);
const lease = `WISP_TEST_LEASE=${unit.slice("agent-capacity-".length, -".scope".length)}`;
const members = () => readdirSync("/proc").filter((entry) => /^\d+$/.test(entry)).filter((pid) => {
  try {
    return readFileSync(`/proc/${pid}/environ`, "latin1").split("\0").includes(lease);
  } catch {
    return false;
  }
}).map(Number);
if (verb === "show") console.log(members().length > 0 ? "active" : "inactive");
else if (verb === "kill") {
  const signal = rest.find((arg) => arg.startsWith("--signal="))?.slice("--signal=".length) ?? "SIGTERM";
  for (const pid of members()) try { process.kill(pid, signal); } catch {}
} else process.exit(1);
