// Runtime errors from engine callbacks. Each is written to a file where
// `wisp hot` maps its Lua positions back to TypeScript lines, and shown in game
// unless the map's runtime configuration sets errorsOnScreen to false.
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

interface StackFrames {
  depth: number;
  frames: Record<number, string | undefined>;
}

interface ShadowStack extends StackFrames {
  failure?: (StackFrames & { error: unknown }) | undefined;
}

declare global {
  var __wispStack: ShadowStack | undefined;
  /** The latest value a compiled `throw` raised, and that statement's TypeScript file and line. */
  var __wispThrown: unknown;
  var __wispThrowSite: string | undefined;
}

/** The callback boundary restores this depth after Lua unwinds a failed call. */
export function stackDepth(): number {
  return globalThis.__wispStack?.depth ?? 0;
}

export function restoreStack(depth: number): void {
  const stack = globalThis.__wispStack;
  if (stack === undefined) return;
  stack.depth = depth;
  stack.failure = undefined;
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

/** Compiler-recorded TypeScript frames work in Warcraft without Lua's debug library. */
export function traceback(error?: unknown): string {
  const stack = globalThis.__wispStack;
  if (stack !== undefined) {
    const frames = stack.failure !== undefined && stack.failure.error === error ? stack.failure : stack;
    const lines: string[] = [];
    for (let depth = frames.depth; depth > 0; depth--) {
      const frame = frames.frames[depth];
      if (frame !== undefined) lines.push(frame);
    }
    return lines.join("\n");
  }
  return typeof debug === "object" ? debug.traceback(undefined, 3) : "";
}

/** Without a stack, a thrown value's report starts with its throw site, as a runtime fault's starts with its Lua position. */
function throwSite(error: unknown, stack: string): string | undefined {
  return stack === "" && error === globalThis.__wispThrown ? globalThis.__wispThrowSite : undefined;
}

export function reportError(handler: string, error: unknown, stack: string): void {
  const configuration = runtimeConfiguration();
  const globals = globalThis as Record<`${string}Errors`, ErrorState | undefined>;
  const state = (globals[`${configuration.globalPrefix}Errors`] ??= { last: undefined, count: 0 });
  const site = throwSite(error, stack);
  const message = site === undefined ? describe(error) : `${site}: ${describe(error)}`;
  if (message === state.last) return;
  state.last = message;
  state.count++;
  if (configuration.errorsOnScreen !== false) DisplayTextToPlayer(GetLocalPlayer(), 0, 0, `error in ${handler}: ${message}`);
  PreloadGenClear();
  PreloadGenStart();
  Preload(errorHeading(state.count, handler));
  for (const line of [message, ...stack.split("\n")]) if (line !== "") Preload(line.slice(0, MAX_LINE));
  PreloadGenEnd(errorFile(GetPlayerId(GetLocalPlayer()), configuration.filePrefix));
}
