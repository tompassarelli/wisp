import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Console, Effect } from "effect";
import { ProcessTable } from "../contract/services";
import { prefixFromDocuments } from "../os/warcraft/battleNet";
import * as desktop from "../os/warcraft/desktop";
import { liveBuild } from "../os/warcraft/liveBuild";
import { buildOf, shareStorage, sharedFiles, unshareStorage } from "../os/warcraft/sharedStorage";
import { UsageFailure } from "../cli/command";
import { ServiceProblem } from "../process/hostProcess";

const gigabytes = (bytes: number) => `${(bytes / 2 ** 30).toFixed(1)} GiB`;

const installOfPrefix = (prefix: string) => join(prefix, "drive_c/Program Files (x86)/Warcraft III");
const launcherOfPrefix = (prefix: string) => join(prefix, "drive_c/Program Files (x86)/Battle.net/Battle.net Launcher.exe");

const runningIn = (installs: readonly string[]) => ProcessTable.use((table) => table.list).pipe(
  Effect.mapError((failure) => new ServiceProblem({ problem: failure.message })),
  Effect.map((processes) => installs.filter((install) => processes.some(({ prefix }) => prefix !== undefined && `${install}/`.startsWith(`${resolve(prefix)}/`)))),
);

export const shareInstalls = (args: readonly string[]) => Effect.gen(function*() {
  const installs = [...new Set(args.map((path) => resolve(path)))];
  const invalid = installs.filter((install) => !existsSync(join(install, ".build.info")) || !existsSync(join(install, "Data")));
  if (installs.length < 2 || args.some((arg) => arg.startsWith("-"))) return yield* new UsageFailure({ problem: "share takes a BASE install and one or more INSTALL folders" });
  if (invalid.length > 0) return yield* new UsageFailure({ problem: `not a Warcraft III install (no .build.info and Data): ${invalid.join(", ")}` });
  const busy = yield* runningIn(installs);
  if (busy.length > 0) return yield* new ServiceProblem({ problem: `a client is running in ${busy.join(", ")}; stop it first` });
  const [base, ...views] = installs;
  const shared = yield* shareStorage(base!, views).pipe(Effect.mapError((failure) => new ServiceProblem({ problem: failure.message })));
  yield* Console.log(`linked ${shared.linked} files of ${views.length} installs to ${base}'s storage and _retail_ and removed ${shared.removed} it lacks, freeing ${gigabytes(shared.freedBytes)}`);
});

export const unshareBehindLive = (clientsFile: string, names: readonly string[]) => Effect.gen(function*() {
  const config = yield* desktop.readClientsFile(clientsFile).pipe(Effect.mapError((cause) => new ServiceProblem({ problem: cause.message })));
  const updating = config.clients.filter((client) => client.offline !== true && (names.length === 0 || names.includes(client.name))).flatMap((client) => {
    const prefix = prefixFromDocuments(client.documents);
    return prefix !== undefined && existsSync(launcherOfPrefix(prefix)) && existsSync(join(installOfPrefix(prefix), ".build.info")) && sharedFiles(installOfPrefix(prefix)).length > 0
      ? [{ name: client.name, install: installOfPrefix(prefix) }]
      : [];
  });
  if (updating.length === 0) return;
  const live = yield* liveBuild.pipe(Effect.option);
  if (live._tag === "None") {
    yield* Console.log(`no live Warcraft III build read; ${updating.map(({ name }) => name).join(", ")} keep sharing storage; don't let Battle.net update them until \`client start\` reads the live build`);
    return;
  }
  for (const { name, install } of updating) {
    const build = buildOf(install);
    if (build === live.value) continue;
    const own = yield* unshareStorage(install).pipe(Effect.mapError((failure) => new ServiceProblem({ problem: `${name}: ${failure.message}` })));
    yield* Console.log(`${name}: on ${build ?? "an unknown build"}, live is ${live.value}; gave it its own copy of ${own.files} shared storage files (${gigabytes(own.bytes)}) so Battle.net can update it; run \`client share\` once its siblings are updated`);
  }
});
