// Every `bun test` here runs its Lua tests in the pinned Lua32s: LUA and
// TOWARD_ZERO_LUA, when unset, name the cached builds (wisp:scripts/wisp/lua32.ts).
import { Effect } from "effect";
import { provideLua32Env } from "../scripts/wisp/lua32";

await Effect.runPromise(provideLua32Env);
