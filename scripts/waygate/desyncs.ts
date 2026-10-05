// Desyncs: Warcraft's own desync reports, compared across the clients. When the
// game detects a desync, each client writes Errors/<UTC time> <id>/Desync.txt
// beside its CustomMapData: the turn and every engine subsystem's checksum. The
// values that differ between the clients name the subsystem that diverged.
import { dirname, join } from "node:path";
import { Clock, Context, Effect, Layer, Option, Schema } from "effect";
import { MalformedGameFile } from "./boundary";
import { GameFiles, type GameFileFailure } from "./gameFiles";

export interface DesyncSummary {
  readonly turn: number;
  /** Engine values in report order, such as `tempest checksum` or `next birth tag`. */
  readonly values: readonly (readonly [name: string, value: string])[];
}

const ASSERTION_START = "<Exception.Assertion:>";
const ASSERTION_END = "<:Exception.Assertion>";
const Turn = Schema.FiniteFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 0xffffffff }));

/** A Desync.txt's turn and engine values; undefined while the game is still writing them. */
export const decodeDesyncSummary = (file: string, text: string): Effect.Effect<DesyncSummary | undefined, MalformedGameFile> =>
  Effect.gen(function*() {
    const lines = text.split(/\r?\n/);
    const start = lines.indexOf(ASSERTION_START);
    const end = lines.indexOf(ASSERTION_END);
    if (start < 0 || end < start) return undefined;
    const heading = lines.map((line) => /^Network desync on turn (\d+) in game /.exec(line)?.[1]).find((turn) => turn !== undefined);
    const turn = yield* Schema.decodeUnknownEffect(Turn)(heading).pipe(
      Effect.mapError((issue) => new MalformedGameFile({ file, field: "turn", problem: issue.message })),
    );
    const values: [string, string][] = [];
    for (const line of lines.slice(start + 1, end)) {
      const tags = /^War3 next presence tag (\d+) next birth tag (\d+)$/.exec(line);
      const value = /^War3 (.+) (\S+)$/.exec(line);
      if (tags !== null) values.push(["next presence tag", tags[1] ?? ""], ["next birth tag", tags[2] ?? ""]);
      else if (value !== null) values.push([value[1] ?? "", value[2] ?? ""]);
      else if (line.trim() !== "") return yield* new MalformedGameFile({ file, field: "engine value", problem: `unrecognized line ${JSON.stringify(line)}` });
    }
    return { turn, values };
  });

export interface DesyncDifference {
  readonly name: string;
  /** One value per summary, in the summaries' order. */
  readonly values: readonly string[];
}

/** Every engine value that is not the same in all summaries. */
export function divergedValues(summaries: readonly DesyncSummary[]): readonly DesyncDifference[] {
  const tables = summaries.map(({ values }) => new Map(values));
  const names = [...new Set(summaries.flatMap(({ values }) => values.map(([name]) => name)))];
  return names.flatMap((name) => {
    const values = tables.map((table) => table.get(name) ?? "missing");
    return new Set(values).size > 1 ? [{ name, values }] : [];
  });
}

export interface DesyncReport {
  /** Clients, by their --data position, whose reports are compared. */
  readonly clients: readonly number[];
  /** Each compared client's desync turn. */
  readonly turns: readonly number[];
  readonly differences: readonly DesyncDifference[];
  /** Clients that wrote no report within PARTNER_WAIT_MILLIS of the first. */
  readonly missing: readonly number[];
  readonly paths: readonly string[];
  /** Milliseconds from the last compared report's write until this comparison. */
  readonly latency: number;
}

/** Every client writes its report within milliseconds of the others; one that hasn't after this, won't. */
export const PARTNER_WAIT_MILLIS = 1000;

const FileFailureCode = Schema.Struct({ code: Schema.String });
function missingDirectory(failure: GameFileFailure): boolean {
  const code = Schema.decodeUnknownOption(FileFailureCode)(failure.cause);
  return Option.isSome(code) && code.value.code === "ENOENT";
}

interface Pending { readonly client: number; readonly path: string; readonly summary: DesyncSummary; readonly modified: number }

export class Desyncs extends Context.Service<Desyncs, {
  /** A desync every client has reported since the previous look; undefined until there is one. */
  readonly changed: Effect.Effect<DesyncReport | undefined, GameFileFailure | MalformedGameFile>;
}>()("waygate/Desyncs") {
  static readonly layer = (dataDirectories: readonly string[]) => Layer.effect(Desyncs, Effect.gen(function*() {
    const files = yield* GameFiles;
    const directories = dataDirectories.map((directory) => join(dirname(directory), "Errors"));
    const reports = (directory: string) => files.list(directory).pipe(
      Effect.catchTag("GameFileFailure", (failure) => missingDirectory(failure) ? Effect.succeed([]) : Effect.fail(failure)),
      // Folder names start with their UTC time, so name order is write order.
      Effect.map((entries) => [...entries].sort()),
    );
    // Reports that predate this session are old news, including when no Errors folder exists yet.
    const seen = yield* Effect.forEach(directories, (directory) => reports(directory).pipe(Effect.map((entries) => new Set(entries))));
    const pending = new Map<number, Pending>();
    let firstPending = 0;
    return Desyncs.of({ changed: Effect.gen(function*() {
      for (const [client, directory] of directories.entries()) {
        if (pending.has(client)) continue;
        for (const name of yield* reports(directory)) {
          if (seen[client]?.has(name)) continue;
          // Crash reports share the folder and have no Desync.txt.
          const path = join(directory, name, "Desync.txt");
          const stored = yield* files.read(path);
          if (stored === undefined) continue;
          // A malformed report fails once, not on every look.
          const summary = yield* decodeDesyncSummary(path, stored.text).pipe(Effect.tapError(() => Effect.sync(() => seen[client]?.add(name))));
          if (summary === undefined) continue;
          seen[client]?.add(name);
          if (pending.size === 0) firstPending = yield* Clock.currentTimeMillis;
          pending.set(client, { client, path, summary, modified: stored.modified });
          break;
        }
      }
      if (pending.size === 0) return undefined;
      const now = yield* Clock.currentTimeMillis;
      if (pending.size < directories.length && now - firstPending < PARTNER_WAIT_MILLIS) return undefined;
      const compared = [...pending.values()].sort((a, b) => a.client - b.client);
      pending.clear();
      return {
        clients: compared.map(({ client }) => client),
        turns: compared.map(({ summary }) => summary.turn),
        differences: compared.length < 2 ? [] : divergedValues(compared.map(({ summary }) => summary)),
        missing: directories.flatMap((_, client) => compared.some((report) => report.client === client) ? [] : [client]),
        paths: compared.map(({ path }) => path),
        latency: now - Math.max(...compared.map(({ modified }) => modified)),
      };
    }) });
  }));
}

export function formatDesync(report: DesyncReport): string {
  const client = (index: number) => `client ${report.clients[index] ?? index}`;
  const turns = new Set(report.turns).size === 1 ? `turn ${report.turns[0]}` : `turns ${report.turns.map((turn, index) => `${turn} (${client(index)})`).join(", ")}`;
  const diverged = report.differences.map(({ name, values }) => `${name} (${values.map((value, index) => `${client(index)}: ${value}`).join(", ")})`);
  const findings = [
    ...(diverged.length > 0 ? [`diverged: ${diverged.join(", ")}`] : report.clients.length > 1 ? ["every reported engine value matches"] : []),
    ...(report.missing.length > 0 ? [`${report.missing.map((index) => `client ${index}`).join(", ")} wrote no desync report within ${PARTNER_WAIT_MILLIS} ms`] : []),
  ];
  return `Warcraft desync on ${turns}, ${findings.join("; ")}; ${report.latency.toFixed(0)} ms after the game wrote its report\n${report.paths.join("\n")}`;
}
