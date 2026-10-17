import { Effect } from "effect";
import { provideLua32Env } from "../scripts/wisp/compile/lua32";

await Effect.runPromise(provideLua32Env);
