import { Effect, Schema } from "effect";
import { ResourceAccounting } from "../contract/services";
import { capacityCommand, capacityProgram } from "../process/capacityHost";

class GpuLeaseRequired extends Schema.TaggedError<GpuLeaseRequired, { readonly brand: unique symbol }>()("GpuLeaseRequired", {
  command: Schema.String,
}) {
  override get message(): string {
    return `Chrome renders run inside a gpu machine-capacity lease, and this run holds none. Run it under one, which waits for a free gpu slot:\n  ${this.command}`;
  }
}

const quoted = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`);

/**
 * Fails before Chrome starts when this machine has north's capacity admission and the run is outside a lease, naming the
 * command that reruns `argv` in a gpu lease. The lease check is the cgroup's, which doesn't tell classes apart.
 */
export const requireGpuLease = (argv: readonly string[] = process.argv) => Effect.gen(function*() {
  const program = capacityProgram();
  if (program === undefined || (yield* ResourceAccounting.use((accounting) => Effect.sync(accounting.insideCapacityLease)))) return;
  return yield* new GpuLeaseRequired({ command: leaseCommand(program, argv).map(quoted).join(" ") });
});

const leaseCommand = (program: string, argv: readonly string[]) => [...capacityCommand(program), "run", "--class", "gpu", "--owner", "wisp-render", "--timeout-seconds", "900", "--", ...argv];

/** Reruns `argv` inside a gpu lease and gives its exit code, or undefined when this run already holds one or the machine has no north. */
export const rerunInGpuLease = (argv: readonly string[] = process.argv) => Effect.gen(function*() {
  const program = capacityProgram();
  if (program === undefined || (yield* ResourceAccounting.use((accounting) => Effect.sync(accounting.insideCapacityLease)))) return undefined;
  const [command, ...rest] = leaseCommand(program, argv);
  return yield* Effect.promise(() => Bun.spawn([command ?? "", ...rest], { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited);
});
