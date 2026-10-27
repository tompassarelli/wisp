import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Option, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { ResourceAccounting } from "../os/platform/services";

/** The machine-capacity helper script, or undefined where none is installed (CI, cloud, other machines). `WISP_CAPACITY_HELPER` names it directly. */
export const capacityHelper = Effect.gen(function*() {
  const given = process.env["WISP_CAPACITY_HELPER"];
  if (given !== undefined) return existsSync(given) ? given : undefined;
  const skill = yield* ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(ChildProcess.make("agents", ["path", "machine-capacity"], { stderr: "ignore" }))).pipe(
    Effect.option,
  );
  const helper = Option.map(skill, (path) => join(dirname(path.trim()), "scripts/machine-capacity.mjs"));
  return Option.isSome(helper) && existsSync(helper.value) ? helper.value : undefined;
});

class GpuLeaseRequired extends Schema.TaggedError<GpuLeaseRequired, { readonly brand: unique symbol }>()("GpuLeaseRequired", {
  command: Schema.String,
}) {
  override get message(): string {
    return `Chrome renders run inside a gpu machine-capacity lease, and this run holds none. Run it under one, which waits for a free gpu slot:\n  ${this.command}`;
  }
}

const quoted = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`);

/**
 * Fails before Chrome starts when this machine has a capacity helper and the run is outside a lease, naming the
 * command that reruns `argv` in a gpu lease. The lease check is the cgroup's, which doesn't tell classes apart.
 */
export const requireGpuLease = (argv: readonly string[] = process.argv) => Effect.gen(function*() {
  const helper = yield* capacityHelper.pipe(Effect.provide(BunServices.layer));
  if (helper === undefined || (yield* ResourceAccounting.use((accounting) => Effect.sync(accounting.insideCapacityLease)))) return;
  return yield* new GpuLeaseRequired({ command: [process.execPath, helper, "run", "--class", "gpu", "--owner", "wisp-render", "--", ...argv].map(quoted).join(" ") });
});
