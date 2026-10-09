




import { SAVED_FILES_ENV, WARM_ENV } from "./devResult";

export interface WaitingTestRequest {
  readonly file: string;

  readonly env: Readonly<Record<string, string>>;
}

const warm: unknown = JSON.parse(process.env[WARM_ENV] ?? "[]");
if (!Array.isArray(warm)) throw new Error(`${WARM_ENV} is not a list of modules`);
for (const module of warm) await import(String(module));


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
