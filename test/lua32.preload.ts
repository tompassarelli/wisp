import { Effect } from "effect";
import { provideLua32Env } from "../host/compile/lua32";

await Effect.runPromise(provideLua32Env);
