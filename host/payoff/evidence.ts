import { basename, join, parse } from "node:path";
import { Effect, FileSystem, Option, Schema } from "effect";

export interface Run {
  readonly path: string;
  readonly kind: string;
  readonly script: string | null;
  readonly at: number;
  readonly client_minutes: number;
  readonly estimated: boolean;
  readonly agreement: boolean | null;
  readonly invalid: boolean;
}

type Fields = Readonly<Record<string, unknown>>;

const EVIDENCE_FILES = new Set(["batch.json", "report.json"]);
const EvidenceJson = Schema.fromJsonString(Schema.Unknown);

const fields = (value: unknown): Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Fields : {};
const text = (value: unknown, key: string): string => {
  const found = fields(value)[key];
  return typeof found === "string" ? found : "";
};
const number = (value: unknown, key: string): number => {
  const found = fields(value)[key];
  return typeof found === "number" && Number.isFinite(found) && found >= 0 ? found : 0;
};
const whole = (value: unknown, key: string): number => {
  const found = fields(value)[key];
  return typeof found === "number" && Number.isSafeInteger(found) ? found : 0;
};
const list = (value: unknown, key: string): readonly unknown[] | undefined => {
  const found = fields(value)[key];
  return Array.isArray(found) ? found : undefined;
};

/** The directory part of a slash-separated script path, empty for a bare file name. */
export const parentOf = (script: string): string => script.includes("/") ? script.slice(0, script.lastIndexOf("/")) : "";

function family(script: string): string {
  const parent = parentOf(script);
  const name = parent === "" ? "unknown" : parent.slice(parent.lastIndexOf("/") + 1) || "unknown";
  return name === "pads" ? `pad/${parse(script).name}` : `pad/${name}`;
}

function padRun(path: string, entry: unknown, fallback: number): Run {
  const verdict = text(entry, "verdict");
  const compared = number(entry, "compare") > 0 && number(entry, "headless") > 0 && !text(entry, "summary").startsWith("compare failed:");
  const agreement = !compared ? null : verdict === "PASS" ? true : verdict === "FAIL" ? false : null;
  const minutes = ["game", "reset", "reload", "run"].reduce((sum, key) => sum + number(entry, key), 0) / 30;
  return { path, kind: family(text(entry, "script")), script: text(entry, "script"), at: fallback, client_minutes: minutes, estimated: false, agreement, invalid: verdict === "INVALID" };
}

function padRuns(path: string, value: unknown, scripts: readonly unknown[], fallback: number): Run[] {
  const batch = fields(value);
  const pairs = list(value, "pairs");
  if (typeof batch["fresh_each"] !== "boolean" || typeof batch["hot"] !== "boolean" || pairs === undefined) return [];
  return scripts
    .filter((entry) => text(entry, "script") !== "" && text(entry, "pair") !== "session" && pairs.some((pair) => pair === text(entry, "pair")))
    .map((entry) => padRun(path, entry, fallback));
}

function acceptRuns(path: string, value: unknown, fallback: number): Run[] {
  const results = (list(value, "results") ?? []).filter((entry) => text(entry, "id") !== "" && text(entry, "verdict") !== "skipped");
  const started = whole(value, "started");
  const elapsed = Math.max(whole(value, "finished") - started, 0) / 30_000;
  return results.map((entry) => ({
    path,
    kind: `accept/${text(entry, "id")}`,
    script: null,
    at: started > 0 ? Math.trunc(started / 1000) : fallback,
    client_minutes: elapsed / Math.max(results.length, 1),
    estimated: true,
    agreement: null,
    invalid: text(entry, "verdict") === "invalid",
  }));
}

/** The native runs one evidence file records: a pad batch's scripts or an accept report's checks; headless sessions record none. */
function decode(path: string, value: unknown, fallback: number): Run[] {
  if (fields(value)["headless_session"] === true) return [];
  const scripts = list(value, "scripts");
  return scripts !== undefined ? padRuns(path, value, scripts, fallback) : acceptRuns(path, value, fallback);
}

const describe = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/** Every batch.json and report.json under `root`, not following symlinks; a missing root holds none. */
export const discover = (root: string, warnings: string[]): Effect.Effect<string[], never, FileSystem.FileSystem> => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const entries = yield* fs.readDirectory(root, { recursive: true }).pipe(Effect.catch((error) => {
    if (error.reason._tag !== "NotFound") warnings.push(`${root}: ${describe(error)}`);
    return Effect.succeed([] as string[]);
  }));
  const found: string[] = [];
  for (const entry of entries.filter((name) => EVIDENCE_FILES.has(basename(name)))) {
    const path = join(root, entry);
    if (Option.isNone(yield* Effect.option(fs.readLink(path)))) found.push(path);
  }
  return found;
});

/** The runs in one evidence file; a pad batch is dated by the file's modification time. */
export const read = (path: string) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const value = yield* Schema.decodeEffect(EvidenceJson)(yield* fs.readFileString(path));
  const info = yield* fs.stat(path);
  const modified = Option.getOrElse(info.mtime, () => new Date(0));
  return decode(path, value, Math.trunc(modified.getTime() / 1000));
});
