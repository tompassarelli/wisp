import { Effect, Schema } from "effect";
import { step } from "../../process/timings";
import { type Client, ClientsFile, DesktopFailure, type Region } from "../../contract/client";

export class ToplevelMissing extends Schema.TaggedError<ToplevelMissing, { readonly brand: unique symbol }>()("ToplevelMissing", {
  title: Schema.String,
}) {
  override get message(): string {
    return `the compositor lists no ${this.title} toplevel`;
  }
}

/** Whether `error`, or a cause it wraps, is a client whose compositor lists no toplevel for its game window. */
export const toplevelMissing = (error: unknown): boolean => {
  for (let at = error, depth = 0; typeof at === "object" && at !== null && depth < 8; at = (at as { readonly cause?: unknown }).cause, depth++) {
    if ("_tag" in at && at._tag === "ToplevelMissing") return true;
  }
  return false;
};

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

/** Runs `command` to its exit and succeeds with its exit code and stderr; fails only when it can't be run. */
export function toolExit(client: string, operation: string, command: readonly string[], env: Record<string, string>) {
  return Effect.acquireUseRelease(
    Effect.try({
      try: () => Bun.spawn([...command], { env: { ...Bun.env, ...env }, stdin: "ignore", stdout: "ignore", stderr: "pipe" }),
      catch: fail(operation, client),
    }),
    (child) => Effect.tryPromise({
      try: async () => {
        const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
        return { code, stderr: stderr.trim() };
      },
      catch: fail(operation, client),
    }),
    (child) => Effect.promise(async () => {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
    }),
  );
}

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
