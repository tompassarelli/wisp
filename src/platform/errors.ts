// Runtime errors from engine callbacks. Each is shown in game and written to a
// file where `waygate hot` maps its Lua positions back to TypeScript lines.
// A broken per-frame handler fails every frame, so a message is written only
// when it differs from the previous one.
import { errorFile, errorHeading } from "../runtime/gameFiles";
import { runtimeConfiguration } from "../runtime/config";

/** Preload lines longer than this are cut so the file stays readable. */
const MAX_LINE = 240;

interface ErrorState {
  last: string | undefined;
  count: number;
}

/** Lua runtime errors are strings that start with their position; thrown Errors are tables. */
function describe(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    // Not tostring: TypeScriptToLua's Error.__tostring needs the debug library.
    const name = "name" in error ? String(error.name) : "Error";
    return `${name}: ${String(error.message)}`;
  }
  return String(error);
}

/** The call stack at the error, when the game provides the debug library. */
export function traceback(): string {
  return typeof debug === "object" ? debug.traceback(undefined, 3) : "";
}

export function reportError(handler: string, error: unknown, stack: string): void {
  const configuration = runtimeConfiguration();
  const globals = globalThis as Record<`${string}Errors`, ErrorState | undefined>;
  const state = (globals[`${configuration.globalPrefix}Errors`] ??= { last: undefined, count: 0 });
  const message = describe(error);
  if (message === state.last) return;
  state.last = message;
  state.count++;
  DisplayTextToPlayer(GetLocalPlayer(), 0, 0, `error in ${handler}: ${message}`);
  PreloadGenClear();
  PreloadGenStart();
  Preload(errorHeading(state.count, handler));
  for (const line of [message, ...stack.split("\n")]) if (line !== "") Preload(line.slice(0, MAX_LINE));
  PreloadGenEnd(errorFile(GetPlayerId(GetLocalPlayer()), configuration.filePrefix));
}
