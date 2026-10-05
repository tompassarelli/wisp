// A dev-loop Bun test process (wisp:docs/dev.md), started before a save as
// `bun test testWait.ts`: it loads the installed modules WISP_DEV_WARM names,
// waits for one line on stdin naming a test file and its environment, then
// loads that file, whose tests Bun runs as this file's. One test file per
// process, since a test file may set up globals for its own tests only.
import { SAVED_FILES_ENV, WARM_ENV } from "./devResult";

export interface WaitingTestRequest {
  readonly file: string;
  /** Set before the file loads, such as SAVED_FILES_ENV for a per-file audit. */
  readonly env: Readonly<Record<string, string>>;
}

const warm: unknown = JSON.parse(process.env[WARM_ENV] ?? "[]");
if (!Array.isArray(warm)) throw new Error(`${WARM_ENV} is not a list of modules`);
for (const module of warm) await import(String(module));

// Bun's test runner leaves `console` without stdin lines, so read the stream.
let text = "";
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  text += decoder.decode(chunk, { stream: true });
  if (text.includes("\n")) break;
}
if (!text.includes("\n")) throw new Error("no test file on stdin");
const request = JSON.parse(text.slice(0, text.indexOf("\n"))) as WaitingTestRequest;
delete process.env[SAVED_FILES_ENV];
Object.assign(process.env, request.env);
await import(request.file);
