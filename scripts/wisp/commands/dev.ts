import { Effect } from "effect";
import { type Command, UsageFailure, flagValues } from "../command";
import { hotServices, hotSide } from "../dev/hot";
import { loop } from "../dev/loop";
import type { DevProject } from "../dev/project";
import { validateDataDirectories } from "./hot";

export type { DevProject };

export const makeDev = (project: DevProject): Command => (args) => Effect.gen(function*() {
  const data = flagValues(args, "data");
  const [since] = flagValues(args, "since");
  if (since !== undefined) {
    if (data.length > 0) return yield* new UsageFailure({ problem: "dev --since takes no --data" });
    return yield* loop(project, undefined, Date.now, since);
  }
  if (data.length === 0) return yield* loop(project, undefined, Date.now);
  const hotProject = project.hot;
  if (hotProject === undefined) return yield* new UsageFailure({ problem: "this project declares no map to hot-reload" });
  const directories = yield* validateDataDirectories(data);
  yield* Effect.flatMap(hotSide(hotProject, directories), (hot) => loop(project, hot, Date.now)).pipe(Effect.provide(hotServices(hotProject, directories)));
});
