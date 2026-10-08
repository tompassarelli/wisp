// The native corpus (wisp:docs/autopsy.md#corpus): every session inside
// `withAutopsy` keeps the files its clients' maps wrote to CustomMapData
// (match replays, moments, input traces), with the source that recorded them,
// so a game can replay each native recording headless later. Reading them is
// a passive file read, allowed on signed-in clients.
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Cause, Effect, FileSystem, Option, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { Client } from "../clients";
import { describeCause } from "../command";

export class CorpusFailure extends Schema.TaggedError<CorpusFailure>()("CorpusFailure", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

/** A single file over this is skipped with one printed line. */
export const MAX_RECORDED_BYTES = 16 * 1024 * 1024;

interface FileState {
  readonly size: number;
  readonly mtimeMs: number;
}

/** Each client's CustomMapData top-level regular files: name to size and mtime. */
export type Listings = ReadonlyMap<string, ReadonlyMap<string, FileState>>;

type CorpusClient = Pick<Client, "name" | "documents">;

const failure = (what: string) => (cause: unknown) => new CorpusFailure({ problem: `${what}: ${describeCause(cause)}` });

const listMapData = (documents: string) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const folder = join(documents, "CustomMapData");
  const listing = new Map<string, FileState>();
  if (!(yield* fs.exists(folder))) return listing;
  for (const name of yield* fs.readDirectory(folder)) {
    // A file the game removes between the listing and its stat is simply not there.
    const info = yield* fs.stat(join(folder, name)).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "File") continue;
    listing.set(name, { size: Number(info.value.size), mtimeMs: Option.getOrElse(Option.map(info.value.mtime, (time) => time.getTime()), () => 0) });
  }
  return listing;
}).pipe(Effect.mapError(failure(`listing ${join(documents, "CustomMapData")}`)));

/** Lists every client's CustomMapData at the start of a session. */
export const listCorpus = (clients: readonly CorpusClient[]): Effect.Effect<Listings, CorpusFailure> =>
  Effect.forEach(clients, (client) => Effect.map(listMapData(client.documents), (listing) => [client.name, listing] as const)).pipe(
    Effect.map((entries) => new Map(entries)),
    Effect.provide(BunServices.layer),
  );

const gitOutput = (cwd: string, args: readonly string[]) =>
  ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(ChildProcess.make("git", args, { cwd, stdin: "ignore", stderr: "ignore" }))).pipe(
    Effect.timeout("10 seconds"),
    Effect.mapError(failure(`git ${args.join(" ")}`)),
  );

/** The checkout `cwd` is in: its commit and whether it has changes; undefined outside a git checkout. */
export const gitState = (cwd: string) => Effect.gen(function*() {
  const commit = (yield* gitOutput(cwd, ["rev-parse", "HEAD"])).trim();
  if (!/^[0-9a-f]{40,64}$/.test(commit)) return undefined;
  const status = yield* gitOutput(cwd, ["status", "--porcelain"]);
  return { commit, dirty: status.trim() !== "" };
});

export interface RecordOptions {
  readonly clients: readonly CorpusClient[];
  /** The listings taken at the start. */
  readonly before: Listings;
  /** The recording's folder: `<corpus root>/<stamp>`. */
  readonly out: string;
  /** When the session started, ISO. */
  readonly started: string;
  /** The autopsy's finding lines; empty when no desync. */
  readonly desyncs: readonly string[];
  /** The autopsy session folder, when it found a desync. */
  readonly autopsy: string | undefined;
  readonly print: (line: string) => void;
}

/**
 * Copies every CustomMapData file that is new or changed since `before` into
 * `out/<client>/` and writes `out/session.json`. Writes nothing when no file
 * changed. A failure prints one line and never fails the session.
 */
export const recordCorpus = (options: RecordOptions): Effect.Effect<void> => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const after = yield* listCorpus(options.clients);
  const copies: { readonly client: string; readonly name: string }[] = [];
  for (const client of options.clients) {
    const before = options.before.get(client.name) ?? new Map<string, FileState>();
    for (const [name, now] of after.get(client.name) ?? []) {
      const then = before.get(name);
      if (then !== undefined && then.size === now.size && then.mtimeMs === now.mtimeMs) continue;
      if (now.size > MAX_RECORDED_BYTES) {
        options.print(`corpus: skipped client ${client.name}'s ${name} (${(now.size / 1024 / 1024).toFixed(1)} MiB, over ${MAX_RECORDED_BYTES / 1024 / 1024} MiB)`);
        continue;
      }
      copies.push({ client: client.name, name });
    }
  }
  if (copies.length === 0) return;
  const recorded = options.clients.map(({ name }) => name).filter((name) => copies.some(({ client }) => client === name));
  for (const client of options.clients.filter(({ name }) => recorded.includes(name))) {
    const target = join(options.out, client.name);
    yield* fs.makeDirectory(target, { recursive: true }).pipe(Effect.mapError(failure(`creating ${target}`)));
    for (const { name } of copies.filter((copy) => copy.client === client.name)) {
      yield* fs.copyFile(join(client.documents, "CustomMapData", name), join(target, name)).pipe(Effect.mapError(failure(`copying client ${client.name}'s ${name}`)));
    }
  }
  const cwd = process.cwd();
  const git = yield* gitState(cwd);
  const session = {
    argv: process.argv.slice(1),
    cwd,
    started: options.started,
    ended: new Date().toISOString(),
    clients: recorded,
    ...(git === undefined ? {} : { git }),
    desyncs: options.desyncs,
    ...(options.autopsy === undefined ? {} : { autopsy: options.autopsy }),
  };
  yield* fs.writeFileString(join(options.out, "session.json"), `${JSON.stringify(session, null, 2)}\n`).pipe(Effect.mapError(failure("writing session.json")));
  options.print(`corpus: recorded ${copies.length} file${copies.length === 1 ? "" : "s"} from client ${recorded.join(", ")} into ${options.out}`);
}).pipe(
  Effect.provide(BunServices.layer),
  Effect.catchCause((cause) => Effect.sync(() => options.print(`corpus: recording failed: ${describeCause(Cause.squash(cause))}`))),
);
