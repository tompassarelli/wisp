import { Effect, Schema } from "effect";
import { describeCause } from "../../cli/hostProcess";
import { step } from "../../cli/timings";
import { CLIENT_PROFILE_NAMES } from "./clientProfiles";

export class DesktopFailure extends Schema.TaggedError<DesktopFailure>()("DesktopFailure", {
  operation: Schema.String,
  client: Schema.String,
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `${this.operation} failed for ${this.client}: ${describeCause(this.cause)}`;
  }
}

const ClientsFile = Schema.Struct({
  tools: Schema.Struct({ grim: Schema.String, xdotool: Schema.String, wlrctl: Schema.String, tesseract: Schema.String }),
  clients: Schema.NonEmptyArray(Schema.Struct({ name: Schema.String, run: Schema.String, documents: Schema.String, menuReportPort: Schema.optional(Schema.Int), displaySettings: Schema.optional(Schema.Record(Schema.String, Schema.String)), profile: Schema.optional(Schema.Literals(CLIENT_PROFILE_NAMES)), offline: Schema.optionalKey(Schema.Boolean) })),
});
type Tools = typeof ClientsFile.Type["tools"];

export interface Client {
  readonly name: string;

  readonly documents: string;

  readonly menuReportPort?: number;
  readonly tools: Tools;
  readonly x11: Record<string, string>;
  readonly wayland: Record<string, string>;
  readonly window: string;
}

export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function fail(operation: string, client: string) {
  return (cause: unknown) => new DesktopFailure({ operation, client, cause });
}

export function runTool(client: string, operation: string, command: readonly string[], env: Record<string, string>, stdin?: Uint8Array) {
  const effect = Effect.acquireUseRelease(
    Effect.try({
      try: () => Bun.spawn([...command], { env: { ...Bun.env, ...env }, stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe" }),
      catch: fail(operation, client),
    }),
    (child) => Effect.tryPromise({
      try: async () => {
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), new Response(child.stderr).text(), child.exited]);
        if (code !== 0) throw new Error(`${command[0]} exited ${code}: ${stderr.trim()}`);
        return new Uint8Array(stdout);
      },
      catch: fail(operation, client),
    }),
    (child) => Effect.promise(async () => {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
    }),
  );
  return process.env.WISP_DESKTOP_TIMINGS === "1" ? effect.pipe(step(`${client}: ${operation}`)) : effect;
}

export type ClientsConfig = typeof ClientsFile.Type;
export type ClientEntry = ClientsConfig["clients"][number];

export const readClientsFile = (path: string) =>
  Effect.gen(function*() {
    const raw = yield* Effect.tryPromise({ try: () => Bun.file(path).json(), catch: fail("read clients file", path) });
    const config = yield* Schema.decodeUnknownEffect(ClientsFile)(raw).pipe(Effect.mapError(fail("decode clients file", path)));
    const ports = config.clients.flatMap((client) => client.menuReportPort === undefined ? [] : [client.menuReportPort]);
    if (ports.some((port) => port < 1 || port > 65535) || new Set(ports).size !== ports.length) {
      return yield* new DesktopFailure({ operation: "decode clients file", client: path, cause: "menuReportPort must be a distinct port from 1 to 65535 for each configured client" });
    }
    return config;
  });
