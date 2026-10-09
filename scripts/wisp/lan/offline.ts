



import { readFileSync } from "node:fs";


export function interfaces(netDev: string): string[] {
  return netDev.split("\n").slice(2).map((line) => line.split(":")[0]?.trim() ?? "").filter((name) => name !== "");
}


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
