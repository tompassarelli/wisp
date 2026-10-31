type Entry = { readonly name: string; readonly age: number; readonly ahead: number; readonly states: Readonly<Record<string, string>> };

export function queued(entries: readonly Entry[], inTrain: readonly string[] = []): string[] {
  return entries
    .filter((entry) => entry.ahead > 0 && entry.states.denylist === "success" && entry.states.autoland !== "failure" && !inTrain.includes(entry.name))
    .toSorted((a, b) => a.age - b.age || a.name.localeCompare(b.name))
    .map((entry) => entry.name);
}

export function halves<T>(names: readonly T[]): [T[], T[]] {
  const first = Math.ceil(names.length / 2);
  return [names.slice(0, first), names.slice(first)];
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "queue") console.log(queued(JSON.parse(args[0] ?? "[]"), JSON.parse(args[1] ?? "[]")).join("\n"));
  if (command === "split") for (const half of halves(args)) console.log(half.join(" "));
}
