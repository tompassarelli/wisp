import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { ResourceAccounting } from "../scripts/platform/services";
import { requireGpuLease } from "../scripts/wisp/gpuLease";

test("[spec docs/headless.md] renders refuse to start outside a gpu lease where a capacity helper is installed, naming the lease command", async () => {
  const given = process.env["WISP_CAPACITY_HELPER"];
  const verdict = (helper: string, inside: boolean) => {
    process.env["WISP_CAPACITY_HELPER"] = helper;
    const accounting = Layer.succeed(ResourceAccounting, ResourceAccounting.of({ cpuPressure: () => undefined, cpuLimit: () => undefined, insideCapacityLease: () => inside, threadCpuMillis: () => 0 }));
    return Effect.runPromise(requireGpuLease(["bun", "wisp", "headless", "--render", "out dir"]).pipe(Effect.flip, Effect.map((failure) => failure.message), Effect.orElseSucceed(() => "started"), Effect.provide(accounting)));
  };
  try {
    expect(await verdict(import.meta.path, true)).toBe("started");
    expect(await verdict(`${import.meta.path}.absent`, false)).toBe("started");
    expect(await verdict(import.meta.path, false)).toContain(`${process.execPath} ${import.meta.path} run --class gpu --owner wisp-render -- bun wisp headless --render 'out dir'`);
  } finally {
    if (given === undefined) delete process.env["WISP_CAPACITY_HELPER"];
    else process.env["WISP_CAPACITY_HELPER"] = given;
  }
});
