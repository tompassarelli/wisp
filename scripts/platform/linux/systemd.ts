import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Effect } from "effect";
import { ServiceProblem } from "../../wisp/clientServices";

const run = (command: readonly string[]) => Effect.try({
  try: () => {
    const done = Bun.spawnSync([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    return { code: done.exitCode, out: done.stdout.toString().trim(), err: done.stderr.toString().trim() };
  },
  catch: (cause) => new ServiceProblem({ problem: `${command.slice(0, 2).join(" ")}: ${String(cause)}` }),
});

export const startUnit = (unit: string, command: readonly string[], log?: string) => Effect.gen(function*() {
  yield* run(["systemctl", "--user", "stop", unit]);
  if (log !== undefined) yield* Effect.try({ try: () => mkdirSync(dirname(log), { recursive: true }), catch: (cause) => new ServiceProblem({ problem: `create ${dirname(log)}: ${String(cause)}` }) });
  const started = yield* run([
    "systemd-run", "--user", "--quiet", "--collect", `--unit=${unit}`, "--setenv=PATH",
    ...(log === undefined ? [] : [`--property=StandardOutput=append:${log}`, `--property=StandardError=append:${log}`]),
    "--", ...command,
  ]);
  if (started.code !== 0) return yield* new ServiceProblem({ problem: `systemd-run ${unit}: ${started.err || `exit ${started.code}`}` });
});

export const unitState = (unit: string) => run(["systemctl", "--user", "show", unit, "--property=ActiveState", "--property=ActiveEnterTimestamp", "--property=MainPID"]).pipe(
  Effect.map(({ out }) => {
    const field = (key: string) => new RegExp(`^${key}=(.*)$`, "m").exec(out)?.[1] ?? "";
    return { active: field("ActiveState") || "inactive", since: field("ActiveEnterTimestamp"), pid: Number(field("MainPID")) };
  }),
);

export const stopUnit = (unit: string) => run(["systemctl", "--user", "stop", unit]).pipe(
  Effect.flatMap((done) => (done.code === 0 ? Effect.void : Effect.fail(new ServiceProblem({ problem: `systemctl --user stop ${unit}: ${done.err || `exit ${done.code}`}` })))),
);
