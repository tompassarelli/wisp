// What makes a client offline for Wisp's LAN tooling (wisp:docs/lan.md,
// "Guardrails"): its process sits in a network namespace whose only interface
// is loopback, so nothing it does can reach Battle.net or anyone else. Wisp
// writes into a game's code (the LAN switch) only after this check passes.
import { readFileSync } from "node:fs";

/** Interface names in a /proc/PID/net/dev text. */
export function interfaces(netDev: string): string[] {
  return netDev.split("\n").slice(2).map((line) => line.split(":")[0]?.trim() ?? "").filter((name) => name !== "");
}

/** Why `pid` may reach a network beyond loopback, or undefined when it can't. */
export function isolatedNetworkProblem(pid: number): string | undefined {
  let netDev: string;
  try {
    netDev = readFileSync(`/proc/${pid}/net/dev`, "latin1");
  } catch (cause) {
    return `can't read pid ${pid}'s network namespace (${cause instanceof Error ? cause.message : String(cause)})`;
  }
  const others = interfaces(netDev).filter((name) => name !== "lo");
  if (others.length > 0) return `pid ${pid} has network interfaces besides loopback: ${others.join(", ")}`;
  return undefined;
}
