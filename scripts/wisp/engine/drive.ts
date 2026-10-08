import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { Effect, Schedule, Schema } from "effect";
import { driverCommandFile, driverReadyFile, driverStatusFile } from "../../../src/runtime/nativeDriver";
import { hostPath, linePreloadFile, payloadPreloadFile, preloadLines } from "../boundary";
import { dataDirectory } from "../gameFiles";
import { type EngineClient, attachClient } from "./attach";

export interface DriverClient extends EngineClient {
  readonly documents: string;
}

export interface DriverStatus {
  readonly client: string;
  readonly serial: number;
  readonly frame: number;
  readonly checksum: string;
  readonly paused: boolean;
  readonly players: number;
  readonly slot: number;
  readonly refused: boolean;
}

function statusPath(client: DriverClient, prefix: string): string {
  return hostPath(dataDirectory(client.documents), driverStatusFile(prefix));
}

/** A receipt may be read between PreloadGenStart and PreloadGenEnd. */
function currentStatus(client: DriverClient, prefix: string): DriverStatus | undefined {
  const file = statusPath(client, prefix);
  if (!existsSync(file)) return undefined;
  const line = preloadLines(readFileSync(file, "utf8"))?.[0];
  const fields = /^drive (\d+) (\d+) (\S+) ([01]) (\d+) (\d+) ([01])$/.exec(line ?? "");
  if (fields === null) return undefined;
  return { client: client.name, serial: Number(fields[1]), frame: Number(fields[2]), checksum: fields[3] ?? "", paused: fields[4] === "1", players: Number(fields[5]), slot: Number(fields[6]), refused: fields[7] === "1" };
}

export function readDriverStatus(client: DriverClient, prefix: string): DriverStatus {
  const status = currentStatus(client, prefix);
  if (status === undefined) throw new Error(`${client.name}: no complete native driver status in ${statusPath(client, prefix)}; start a map with startNativeDriver`);
  return status;
}

/** Files cause in-map actions, so use exactly the trap tier's offline and owner-display checks. */
export function verifyDriverClients(clients: readonly DriverClient[]): void {
  for (const client of clients) {
    const attached = attachClient(client, "trap");
    if (typeof attached === "string") throw new Error(attached);
    attached.memory.close();
  }
}

function writeNew(path: string, contents: string | Uint8Array): void {
  if (existsSync(path)) throw new Error(`native driver will not reuse numbered file ${path}`);
  const temporary = `${path}.${process.pid}.next`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

/** Stage every payload first; only then may the leader offer the command for synchronized agreement. */
export function publishDriverCommand(clients: readonly DriverClient[], prefix: string, text: string): number {
  verifyDriverClients(clients);
  const statuses = clients.map(client => readDriverStatus(client, prefix));
  const first = statuses[0];
  if (first === undefined) throw new Error("native driver needs every playing client");
  const mask = statuses.reduce((value, status) => value | (1 << status.slot), 0);
  if (new Set(statuses.map(status => status.slot)).size !== clients.length
    || statuses.some(status => status.players !== mask || status.serial !== first.serial || status.refused)) throw new Error("native driver clients must name every playing slot once, at the same completed command");
  const serial = first.serial + 1;
  const payload = payloadPreloadFile(new TextEncoder().encode(text));
  for (const client of clients) writeNew(hostPath(dataDirectory(client.documents), driverCommandFile(prefix, serial)), payload);
  for (const client of clients) writeNew(hostPath(dataDirectory(client.documents), driverReadyFile(prefix, serial)), linePreloadFile("ready"));
  return serial;
}

export class DriverFailure extends Schema.TaggedError<DriverFailure>()("DriverFailure", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

/** Reads every client's receipt every 10 ms until all completed `serial` (paused at `frame` when given), within `timeoutMs`. */
export const waitDriverCommand = (clients: readonly DriverClient[], prefix: string, serial: number, timeoutMs = 10000, frame?: number) => {
  let statuses: readonly (DriverStatus | undefined)[] = [];
  const look = Effect.suspend(() => {
    statuses = clients.map(client => currentStatus(client, prefix));
    if (statuses.some(status => status?.refused)) return Effect.fail(new DriverFailure({ problem: `native driver refused command ${serial}: clients received different payloads` }));
    const completed = statuses.filter((status): status is DriverStatus => status !== undefined && status.serial === serial && (frame === undefined || status.frame === frame && status.paused));
    return Effect.succeed(completed.length === clients.length ? completed : undefined);
  });
  return look.pipe(
    Effect.repeat({ schedule: Schedule.spaced("10 millis"), until: (completed) => completed !== undefined }),
    Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.fail(new DriverFailure({ problem: `native driver command ${serial} timed out: ${JSON.stringify(statuses)}` })) }),
    // `until` ended the repeat, so every client completed.
    Effect.map((completed) => completed!),
  );
};
