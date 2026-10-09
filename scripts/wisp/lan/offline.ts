import { Effect } from "effect";
import { runPlatformSync } from "../../platform/layer";
import { ProcessTable } from "../../platform/services";


export const isolatedNetworkProblem = (pid: number): string | undefined => runPlatformSync(ProcessTable.use((table) => table.networkInterfaces(pid)).pipe(
  Effect.map((names) => {
    const others = names.filter((name) => name !== "lo");
    return others.length > 0 ? `pid ${pid} has network interfaces besides loopback: ${others.join(", ")}` : undefined;
  }),
  Effect.catch((failure) => Effect.succeed(failure._tag === "PlatformFailure" ? `can't read ${failure.capability} (${failure.problem})` : failure.message)),
));
