import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";
import { GameLauncher } from "../os/platform/services";
import { collect } from "../cli/hostProcess";
import { installMenuPage } from "../play/menus";
import { LanFailure } from "./join";
import { clientRoot, installOf, prefixOf, retailOf } from "./pool";

const run = (what: string, command: readonly string[], env: Readonly<Record<string, string>> = {}) =>
  collect(ChildProcess.make(command[0]!, command.slice(1), { env, extendEnv: true, stdin: "ignore" })).pipe(
    Effect.provide(BunServices.layer),
    Effect.mapError((cause) => new LanFailure({ problem: `${what}: ${cause.message}` })),
    Effect.flatMap(({ exitCode, stderr }) => (exitCode === 0 ? Effect.void
      : Effect.fail(new LanFailure({ problem: `${what}: exited with ${exitCode}: ${stderr.trim().split("\n").slice(-3).join(" | ")}` })))),
  );

const filesUnder = (path: string) => statSync(path).isDirectory()
  ? readdirSync(path, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name))
  : [path];

const buildOf = (install: string) => {
  const [header, ...rows] = readFileSync(join(install, ".build.info"), "utf8").split(/\r?\n/).filter((line) => line.length > 0).map((line) => line.split("|"));
  const column = (name: string) => header?.findIndex((field) => field.split("!")[0] === name) ?? -1;
  const row = rows.find((fields) => fields[column("Active")] === "1") ?? rows[0];
  return row?.[column("Version")] || undefined;
};

const dataFiles = (install: string) => {
  const data = join(install, "Data");
  return existsSync(data) ? filesUnder(data).map((file) => relative(data, file)).sort() : [];
};

const pruneData = (name: string, from: string) => Effect.try({
  try: () => {
    const data = join(installOf(name), "Data");
    if (!existsSync(data)) return [];
    const own = realpathSync(data);
    if (!own.startsWith(`${realpathSync(clientRoot(name))}/`) || (existsSync(join(from, "Data")) && own === realpathSync(join(from, "Data")))) {
      throw new Error(`${data} is not ${name}'s own Data`);
    }
    const kept = new Set(dataFiles(from));
    const extra = dataFiles(installOf(name)).filter((file) => !kept.has(file));
    for (const file of extra) rmSync(join(own, file));
    return extra;
  },
  catch: (cause) => new LanFailure({ problem: `${name}: remove the Data files the source lacks: ${String(cause)}` }),
});

// Clones the install; where cp can't clone (ext4, tmpfs), copies everything outside Data/ and hardlinks Data/'s files to the source's.
// A refresh relinks Data/ instead of writing into a file other clients share; cp -a itself unlinks a hardlinked destination before
// writing it, while a failed clone leaves an unshared destination truncated.
const placeInstall = (name: string, from: string, refresh: boolean) => Effect.gen(function*() {
  const install = installOf(name);
  const cloned = yield* run(`${refresh ? "refresh" : "copy"} the install in ${name}`,
    refresh ? ["cp", "-a", "--reflink=always", `${from}/.`, install] : ["cp", "-a", "--reflink=always", from, install]).pipe(
    Effect.as(true),
    Effect.catchIf((failure) => /failed to clone|are the same file/.test(failure.problem), () => Effect.succeed(false)),
  );
  if (cloned) return "reflinked";
  const copied = readdirSync(from).filter((entry) => entry !== "Data").map((entry) => join(from, entry));
  yield* Effect.try({
    try: () => {
      if (!refresh) rmSync(install, { recursive: true, force: true });
      mkdirSync(install, { recursive: true });
    },
    catch: (cause) => new LanFailure({ problem: `${name}: clear the partial clone: ${String(cause)}` }),
  });
  if (copied.length > 0) yield* run(`copy the install outside Data into ${name}`, ["cp", "-a", ...copied, `${install}/`]);
  const data = join(from, "Data");
  if (existsSync(data) && !refresh) yield* run(`hardlink the install's Data into ${name}`, ["cp", "-al", data, join(install, "Data")]);
  if (existsSync(data) && refresh) {
    yield* Effect.try({
      try: () => {
        for (const source of filesUnder(data)) {
          const target = join(install, "Data", source.slice(data.length));
          if (existsSync(target) && statSync(target).ino === statSync(source).ino) continue;
          rmSync(target, { force: true });
          mkdirSync(dirname(target), { recursive: true });
          linkSync(source, target);
        }
      },
      catch: (cause) => new LanFailure({ problem: `${name}: relink the install's Data: ${String(cause)}` }),
    });
  }
  const bytes = yield* Effect.try({
    try: () => copied.flatMap(filesUnder).reduce((sum, file) => sum + statSync(file).size, 0),
    catch: (cause) => new LanFailure({ problem: `${name}: measure the copied install: ${String(cause)}` }),
  });
  return `linked (Data hardlinked, ${Math.round(bytes / 2 ** 20)} MB copied)`;
});

export const setupClient = (name: string, from: string, poolBuild: string, port: number, log: (line: string) => void) => Effect.gen(function*() {
  if (!existsSync(join(from, "_retail_/x86_64/Warcraft III.exe"))) return yield* new LanFailure({ problem: `${from} isn't a Warcraft III install (no _retail_/x86_64/Warcraft III.exe)` });
  const build = yield* Effect.try({
    try: () => buildOf(from),
    catch: (cause) => new LanFailure({ problem: `${from}: read the install's .build.info: ${String(cause)}` }),
  });
  if (build !== poolBuild) {
    return yield* new LanFailure({ problem: `${from} is build ${build ?? "unknown"}, but the pool runs ${poolBuild}; set up from an install on ${poolBuild}` });
  }
  const root = clientRoot(name);
  if (!existsSync(join(prefixOf(name), "user.reg"))) {
    mkdirSync(root, { recursive: true });
    const appId = "3516115599";
    const registry = yield* GameLauncher.use((launcher) => launcher.inPrefix({
      root, appId, isolateNetwork: true, exe: "C:\\windows\\system32\\reg.exe",
      args: ["add", "HKCU\\Software\\Blizzard Entertainment\\Warcraft III", "/v", "Allow Local Files", "/t", "REG_DWORD", "/d", "1", "/f"],
    })).pipe(Effect.mapError((failure) => new LanFailure({ problem: failure.message })));
    yield* run(`create ${name}'s prefix`, registry.command, registry.env);
    log(`${name}: prefix created with Allow Local Files`);
  }
  if (!existsSync(installOf(name))) {
    const how = yield* placeInstall(name, from, false);
    log(`${name}: install ${how} from ${from}`);
  } else {
    const { stamps, sameData } = yield* Effect.try({
      try: () => ({
        stamps: [join(from, "_retail_/x86_64/Warcraft III.exe"), join(retailOf(name), "x86_64/Warcraft III.exe")].map((exe) => {
          const { size, mtimeMs } = statSync(exe);
          return `${size} bytes, modified ${new Date(mtimeMs).toISOString()}`;
        }),
        sameData: dataFiles(from).join("\n") === dataFiles(installOf(name)).join("\n"),
      }),
      catch: (cause) => new LanFailure({ problem: `${name}: read the install executables and Data: ${String(cause)}` }),
    });
    if (stamps[0] !== stamps[1] || !sameData) {
      const how = yield* placeInstall(name, from, true);
      log(`${name}: install refreshed, ${how} (${stamps[0] !== stamps[1] ? `executable was ${stamps[1]}, now ${stamps[0]}` : "Data's file list differed from the source's"})`);
    }
  }
  const pruned = yield* pruneData(name, from);
  if (pruned.length > 0) log(`${name}: removed ${pruned.length} Data files the source lacks`);
  yield* installMenuPage(retailOf(name), port).pipe(Effect.mapError((failure) => new LanFailure({ problem: failure.message })));
  log(`${name}: menu page reports to 127.0.0.1:${port}`);
});
