import { Effect, Schema } from "effect";

const VERSIONS_URL = "http://us.patch.battle.net:1119/w3/versions";

export class LiveBuildUnread extends Schema.TaggedError<LiveBuildUnread, { readonly brand: unique symbol }>()("LiveBuildUnread", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

export function liveBuildFrom(text: string): string | undefined {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== "" && !line.startsWith("##"));
  const columns = (lines[0] ?? "").split("|").map(column => column.split("!")[0]);
  const region = columns.indexOf("Region"), name = columns.indexOf("VersionsName");
  if (region < 0 || name < 0) return undefined;
  const build = lines.slice(1).map(line => line.split("|")).find(row => row[region] === "us")?.[name];
  return build !== undefined && /^\d+(\.\d+)+$/.test(build) ? build : undefined;
}

const unread = (problem: string) => new LiveBuildUnread({ problem });

export const liveBuild = Effect.tryPromise({ try: () => fetch(VERSIONS_URL).then(response => response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`))), catch: cause => unread(`${VERSIONS_URL}: ${String(cause)}`) }).pipe(
  Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.fail(unread(`${VERSIONS_URL} didn't answer within 10 s`)) }),
  Effect.flatMap(text => {
    const build = liveBuildFrom(text);
    return build === undefined ? Effect.fail(unread(`${VERSIONS_URL} has no us row with a build`)) : Effect.succeed(build);
  }),
);
