import { join } from "node:path";
import { Console, Effect, Schema } from "effect";
import { captureProcess } from "./wisp/mapBuild";
import { issueTests, redTitle } from "./mainRed";

const root = join(import.meta.dir, "..");

const RedIssues = Schema.fromJsonString(Schema.Array(Schema.Struct({ number: Schema.Finite, title: Schema.String, body: Schema.String, url: Schema.String })));

export function redNotice(issue: { readonly number: number; readonly body: string; readonly url: string }): string {
  const tests = issueTests(issue.body);
  const shown = tests.slice(0, 8).join("; ");
  return `pre-push: main is red (#${issue.number} ${issue.url}), ${tests.length} failing: ${shown}${tests.length > 8 ? `; and ${tests.length - 8} more` : ""}`;
}

export const prePush = captureProcess("gh issue list", root,
  ["gh", "issue", "list", "--state", "open", "--search", `"${redTitle("main")}" in:title`, "--json", "number,title,body,url"]).pipe(
  Effect.flatMap(({ exitCode, stdout }) => (exitCode === 0 ? Schema.decodeEffect(RedIssues)(stdout) : Effect.succeed([]))),
  Effect.map((issues) => issues.filter(({ title }) => title === redTitle("main"))),
  Effect.flatMap(Effect.forEach((issue) => Console.error(redNotice(issue)), { discard: true })),
  Effect.timeout("5 seconds"),
  Effect.ignore,
);
