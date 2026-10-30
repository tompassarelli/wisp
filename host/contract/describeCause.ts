export function describeCause(cause: unknown): string {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
