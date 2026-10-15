import { Effect } from "effect";
import { runPlatformSync } from "../../platform/layer";
import { ResourceAccounting } from "../../platform/services";

export type SoakClock = (this: void) => number;

let threadClock: SoakClock | undefined;

export const cpuMillis: SoakClock = () => (threadClock ??= runPlatformSync(ResourceAccounting.use((accounting) => Effect.succeed(accounting.threadCpuMillis))))();
