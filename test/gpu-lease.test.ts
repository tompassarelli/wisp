import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { ResourceAccounting } from "../host/os/platform/services";
import { agentRender } from "../host/play/standalone";
import { requireGpuLease } from "../host/render/gpuLease";

// The shell is the reference for quoting: it must read the named command back as the helper, the gpu class and every argument.
test("[property seed 474] renders start only inside a gpu lease or without a capacity helper, and the named lease command gives the shell back every argument (docs/headless.md)", async () => {
  const given = process.env["WISP_CAPACITY_HELPER"];
  const verdict = (helper: string, inside: boolean, argv: readonly string[]) => {
    process.env["WISP_CAPACITY_HELPER"] = helper;
    const accounting = Layer.succeed(ResourceAccounting, ResourceAccounting.of({ cpuPressure: () => undefined, cpuLimit: () => undefined, insideCapacityLease: () => inside, threadCpuMillis: () => 0 }));
    return Effect.runPromise(requireGpuLease(argv).pipe(Effect.flip, Effect.map((failure) => failure.message), Effect.orElseSucceed(() => "started"), Effect.provide(accounting)));
  };
  const shellWords = (command: string) => {
    const run = Bun.spawnSync(["bash", "-c", `printf '%s\\0' ${command}`], { stdout: "pipe", stderr: "pipe" });
    expect(run.stderr.toString()).toBe("");
    return run.stdout.toString().split("\0").slice(0, -1);
  };
  let seed = 474;
  const next = (below: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) % below;
  };
  const pieces = ["bun", "wisp", "headless", "--render", "out dir", "", "it's", "a\"b", "$HOME", "`x`", "*", "a\\b", "~", "--x=1", "tab\there", "line\nnext", "!", ";", "é"];
  try {
    for (let run = 0; run < 40; run++) {
      const argv = Array.from({ length: next(6) }, () => Array.from({ length: 1 + next(2) }, () => pieces[next(pieces.length)]).join(""));
      const [present, absent] = [import.meta.path, `${import.meta.path}.absent`];
      expect(await verdict(present, true, argv)).toBe("started");
      expect(await verdict(absent, next(2) === 0, argv)).toBe("started");
      const refused = await verdict(present, false, argv);
      const command = refused.slice(refused.indexOf("\n  ") + 3);
      expect(shellWords(command)).toEqual([process.execPath, present, "run", "--class", "gpu", "--owner", "wisp-render", "--", ...argv]);
    }
  } finally {
    if (given === undefined) delete process.env["WISP_CAPACITY_HELPER"];
    else process.env["WISP_CAPACITY_HELPER"] = given;
  }
});

test("only a headless, scripted or capturing standalone run needs a gpu lease, never the window a person plays (docs/play.md)", () => {
  expect(agentRender({})).toBe(false);
  expect(agentRender({ window: "native", frames: 10 })).toBe(false);
  for (const options of [{ headless: true }, { script: "pad.txt" }, { out: "dir" }, { recordChecksums: true }, { captureFrames: [3] }]) expect(agentRender(options)).toBe(true);
});
