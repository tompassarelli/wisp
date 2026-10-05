import { dirname, join } from "node:path";
import { Clock, Context, Effect, Layer, Option, Schema } from "effect";
import { GameFiles, type GameFileFailure, type StoredFile } from "./gameFiles";

export interface DesyncRecord {
  readonly subsystem: number;
  readonly turn: number;
  readonly checksum: string;
  readonly fields: readonly { readonly path: string; readonly value: string }[];
}

/** Warcraft's decimal subsystem identifiers are four-character codes. */
export function subsystemName(id: number): string {
  const code = String.fromCharCode(id >>> 24, (id >>> 16) & 255, (id >>> 8) & 255, id & 255);
  return /^[\x20-\x7e]{4}$/.test(code) ? code : String(id);
}

/** The native log lists each subsystem's current turn followed by earlier turns. */
export function parseDesyncLog(text: string): readonly DesyncRecord[] {
  const records: DesyncRecord[] = [];
  let record: { subsystem: number; turn: number; checksum: string; fields: { path: string; value: string }[] } | undefined;
  let parents: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const header = /^\[Desync - (\d+) - Turn\((\d+)\) = (-?\d+)\]$/.exec(line);
    if (header !== null) {
      record = { subsystem: Number(header[1]), turn: Number(header[2]), checksum: header[3] ?? "", fields: [] };
      records.push(record);
      parents = [];
      continue;
    }
    const field = /^(\t+)#(\d+)#(?:: (0x[\da-fA-F]+))?$/.exec(line);
    if (field !== null && record !== undefined) {
      const depth = field[1]?.length ?? 0;
      const name = `#${field[2]}#`;
      parents.length = depth - 1;
      parents.push(name);
      if (field[3] !== undefined) record.fields.push({ path: parents.join("/"), value: field[3] });
      continue;
    }
    if (line.trim() !== "" && !/^=+$/.test(line)) throw new Error(`unrecognized desync log line: ${line}`);
  }
  return records;
}

export interface DesyncDifference {
  readonly subsystem: string;
  readonly turn: number;
  readonly field: string;
  readonly values: readonly string[];
  readonly checksums: readonly string[];
}

/** Compares the same subsystem and turn, oldest first, across every client's log. */
export function firstDesync(logs: readonly (readonly DesyncRecord[])[]): DesyncDifference | undefined {
  const first = logs[0];
  if (first === undefined || logs.length < 2) return undefined;
  const indexed = logs.map((records) => new Map(records.map((record) => [`${record.subsystem}:${record.turn}`, record])));
  for (const record of [...first].sort((a, b) => a.turn - b.turn)) {
    const peers = indexed.flatMap((records) => {
      const peer = records.get(`${record.subsystem}:${record.turn}`);
      return peer === undefined ? [] : [peer];
    });
    if (peers.length !== logs.length) continue;
    const fields = peers.map((peer) => new Map(peer.fields.map(({ path, value }) => [path, value])));
    const paths = new Set(fields.flatMap((values) => [...values.keys()]));
    for (const field of paths) {
      const values = fields.map((values) => values.get(field) ?? "missing");
      if (new Set(values).size > 1) return { subsystem: subsystemName(record.subsystem), turn: record.turn, field, values, checksums: peers.map((peer) => peer.checksum) };
    }
    const checksums = peers.map((peer) => peer.checksum);
    if (new Set(checksums).size > 1) return { subsystem: subsystemName(record.subsystem), turn: record.turn, field: "checksum", values: checksums, checksums };
  }
  return undefined;
}

export class DesyncLogFailure extends Schema.TaggedError<DesyncLogFailure>()("DesyncLogFailure", {
  path: Schema.String,
  cause: Schema.Unknown,
}) {
  override get message(): string { return `can't decode Warcraft desync log ${this.path}: ${String(this.cause)}`; }
}

export interface DesyncReport extends DesyncDifference {
  readonly paths: readonly string[];
  /** Delay from the last client log write until this comparison. */
  readonly latency: number;
}

const FileFailureCode = Schema.Struct({ code: Schema.String });
function missingDirectory(failure: GameFileFailure): boolean {
  const code = Schema.decodeUnknownOption(FileFailureCode)(failure.cause);
  return Option.isSome(code) && code.value.code === "ENOENT";
}

interface PendingLog { readonly path: string; readonly stored: StoredFile; readonly stable: boolean }

export class Desyncs extends Context.Service<Desyncs, {
  readonly changed: Effect.Effect<DesyncReport | undefined, GameFileFailure | DesyncLogFailure>;
}>()("waygate/Desyncs") {
  static readonly layer = (dataDirectories: readonly string[]) => Layer.effect(Desyncs, Effect.gen(function*() {
    const files = yield* GameFiles;
    const directories = dataDirectories.map((directory) => join(dirname(directory), "Logs"));
    const names = (directory: string) => files.list(directory).pipe(
      Effect.catchTag("GameFileFailure", (failure) => missingDirectory(failure) ? Effect.succeed([]) : Effect.fail(failure)),
      Effect.map((entries) => entries.filter((entry) => /_Desync\.log$/i.test(entry))),
    );
    // Ignore reports that predate this hot session, including when no Logs folder exists yet.
    const seen = yield* Effect.forEach(directories, (directory) => names(directory).pipe(Effect.map((entries) => new Set(entries))));
    const pending = new Map<string, PendingLog>();
    return Desyncs.of({ changed: Effect.gen(function*() {
      for (const [index, directory] of directories.entries()) {
        const old = seen[index];
        for (const name of yield* names(directory)) {
          if (old?.has(name)) continue;
          const path = join(directory, name);
          const stored = yield* files.read(path);
          if (stored === undefined || !stored.text.endsWith("\n")) continue;
          const previous = pending.get(directory);
          if (previous !== undefined && previous.stored.modified > stored.modified) continue;
          pending.set(directory, { path, stored, stable: previous?.path === path && previous.stored.text === stored.text });
        }
      }
      const candidates = directories.flatMap((directory) => {
        const candidate = pending.get(directory);
        return candidate?.stable ? [candidate] : [];
      });
      if (candidates.length !== directories.length || candidates.length < 2) return undefined;
      const logs = yield* Effect.forEach(candidates, ({ path, stored }) => Effect.try({
        try: () => parseDesyncLog(stored.text),
        catch: (cause) => new DesyncLogFailure({ path, cause }),
      }));
      const difference = firstDesync(logs);
      if (difference === undefined) return undefined;
      for (const [index, directory] of directories.entries()) {
        for (const name of yield* names(directory)) seen[index]?.add(name);
      }
      pending.clear();
      return { ...difference, paths: candidates.map(({ path }) => path), latency: (yield* Clock.currentTimeMillis) - Math.max(...candidates.map(({ stored }) => stored.modified)) };
    }) });
  }));
}

export function formatDesync(report: DesyncReport): string {
  const values = report.values.map((value, index) => `client ${index}: ${value}`).join(", ");
  return `Warcraft desync: subsystem ${report.subsystem}, turn ${report.turn}, ${report.field}: ${values} (${report.latency.toFixed(0)} ms after the game wrote its logs)\n${report.paths.join("\n")}`;
}
