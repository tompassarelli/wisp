const DENYLIST_CONTEXT = "denylist";

type DenylistDecision =
  | { readonly action: "test" }
  | { readonly action: "refuse" | "hold"; readonly state: "failure" | "pending"; readonly description: string };

export function denylistState(combinedStatus: unknown): string | undefined {
  const statuses = (combinedStatus as { statuses?: unknown } | null)?.statuses;
  if (!Array.isArray(statuses)) return undefined;
  const status = statuses.find((entry: { context?: unknown }) => entry?.context === DENYLIST_CONTEXT) as { state?: unknown } | undefined;
  return typeof status?.state === "string" ? status.state : undefined;
}

export function denylistDecision(state: string | undefined): DenylistDecision {
  if (state === "success") return { action: "test" };
  if (state === "failure" || state === "error") return { action: "refuse", state: "failure", description: "deny-list refused: reword and push again" };
  return { action: "hold", state: "pending", description: "waiting for the deny-list attestation" };
}

if (import.meta.main) {
  let combined: unknown;
  try {
    combined = JSON.parse(process.argv[2] ?? "");
  } catch {
    combined = undefined;
  }
  const decision = denylistDecision(denylistState(combined));
  console.log(decision.action === "test" ? "test" : [decision.action, decision.state, decision.description].join("\t"));
}
