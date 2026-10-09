// Engine callbacks retain trampolines across reloads; handlers and dispatch state must live in Lua globals.





import { reportError, restoreStack, stackDepth, traceback } from "./errors";
import { runtimeConfiguration } from "../runtime/config";

type Handler = (this: void) => void;

interface DispatchTable {
  handlers: Record<string, Handler | undefined>;
  run: (this: void, name: string) => void;
}


function run(name: string): void {
  const handler = table().handlers[name];
  if (handler !== undefined) {
    const depth = stackDepth();
    xpcall(handler, (error: unknown) => reportError(name, error, traceback(error)));
    restoreStack(depth);
  }
}

function table(): DispatchTable {
  const globals = globalThis as Record<`${string}Dispatch`, DispatchTable | undefined>;
  const key = `${runtimeConfiguration().globalPrefix}Dispatch` as const;
  return (globals[key] ??= { handlers: {}, run });
}


export function installDispatch(): void {
  table().run = run;
}


export function on(name: string, handler: Handler): void {
  table().handlers[name] = handler;
}


export function trampoline(name: string): Handler {
  return () => table().run(name);
}
