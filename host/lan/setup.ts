import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";
import { GameLauncher } from "../contract/services";
import { collect } from "../process/hostProcess";
import { installMenuPage } from "./menus";
import { buildOf, linkPrefix, linkStorage } from "../os/warcraft/sharedStorage";
import { LanFailure } from "./join";
import { PAIR_SIDES, clientName, clientRoot, dataRoot, installOf, prefixOf, retailOf } from "./pool";

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

const SHARED = new Set(["Data", "_retail_"]);

// A new install is cloned where cp can; otherwise, and on every refresh, everything outside Data/ and _retail_ is copied and those two are linked to the source's.
const placeInstall = (name: string, from: string, refresh: boolean) => Effect.gen(function*() {
  const install = installOf(name);
  const cloned = !refresh && (yield* run(`copy the install in ${name}`, ["cp", "-a", "--reflink=always", from, install]).pipe(
    Effect.as(true),
    Effect.catchIf((failure) => /failed to clone/.test(failure.problem), () => Effect.succeed(false)),
  ));
  if (cloned) return "reflinked";
  const copied = readdirSync(from).filter((entry) => !SHARED.has(entry)).map((entry) => join(from, entry));
  yield* Effect.try({
    try: () => {
      if (!refresh) rmSync(install, { recursive: true, force: true });
      mkdirSync(install, { recursive: true });
    },
    catch: (cause) => new LanFailure({ problem: `${name}: clear the partial clone: ${String(cause)}` }),
  });
  if (copied.length > 0) yield* run(`copy the install outside Data and _retail_ into ${name}`, ["cp", "-a", ...copied, `${install}/`]);
  const bytes = yield* Effect.try({
    try: () => copied.flatMap(filesUnder).reduce((sum, file) => sum + statSync(file).size, 0),
    catch: (cause) => new LanFailure({ problem: `${name}: measure the copied install: ${String(cause)}` }),
  });
  return `copied ${Math.round(bytes / 2 ** 20)} MB outside Data and _retail_`;
});

// The pool's first client holds the Wine system files the others link to; it links to none, so the pool never splits between two bases.
const prefixBase = (name: string) => {
  const clients = join(dataRoot(), "clients");
  const [first] = existsSync(clients) ? readdirSync(clients).filter((client) => existsSync(installOf(client))).sort() : [];
  return first !== undefined && first !== name ? first : undefined;
};

const ALLOW_LOCAL_FILES = "\"Allow Local Files\"=dword:00000001";

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
  const userRegistry = join(prefixOf(name), "user.reg");
  if (!existsSync(userRegistry) || !readFileSync(userRegistry, "utf8").includes(ALLOW_LOCAL_FILES)) {
    mkdirSync(root, { recursive: true });
    const appId = "3516115599";
    const registry = yield* GameLauncher.use((launcher) => launcher.inPrefix({
      root, appId, isolateNetwork: true, exe: "C:\\windows\\system32\\reg.exe",
      args: ["add", "HKCU\\Software\\Blizzard Entertainment\\Warcraft III", "/v", "Allow Local Files", "/t", "REG_DWORD", "/d", "1", "/f"],
    })).pipe(Effect.mapError((failure) => new LanFailure({ problem: failure.message })));
    yield* run(`set Allow Local Files in ${name}'s prefix`, registry.command, registry.env);
    log(`${name}: prefix has Allow Local Files`);
  }
  if (!existsSync(installOf(name))) {
    const how = yield* placeInstall(name, from, false);
    log(`${name}: install ${how} from ${from}`);
  } else {
    const { stamps } = yield* Effect.try({
      try: () => ({
        stamps: [join(from, "_retail_/x86_64/Warcraft III.exe"), join(retailOf(name), "x86_64/Warcraft III.exe")].map((exe) => {
          const { size, mtimeMs } = statSync(exe);
          return `${size} bytes, modified ${new Date(mtimeMs).toISOString()}`;
        }),
      }),
      catch: (cause) => new LanFailure({ problem: `${name}: read the install executables: ${String(cause)}` }),
    });
    if (stamps[0] !== stamps[1]) {
      const how = yield* placeInstall(name, from, true);
      log(`${name}: install refreshed, ${how} (executable was ${stamps[1]}, now ${stamps[0]})`);
    } else if (!existsSync(join(installOf(name), ".build.info"))) {
      const how = yield* placeInstall(name, from, true);
      log(`${name}: install refreshed, ${how} (it had only Data and _retail_ left)`);
    }
  }
  const linked = yield* linkStorage(from, installOf(name)).pipe(Effect.mapError((failure) => new LanFailure({ problem: `${name}: ${failure.problem}` })));
  if (linked.linked + linked.removed > 0) log(`${name}: linked ${linked.linked} files to the source's Data and _retail_ and removed ${linked.removed} it lacks`);
  const base = prefixBase(name);
  if (base !== undefined) {
    const prefix = yield* linkPrefix(installOf(base), installOf(name)).pipe(Effect.mapError((failure) => new LanFailure({ problem: `${name}: ${failure.problem}` })));
    if (prefix.linked > 0) log(`${name}: linked ${prefix.linked} Wine system files to ${base}'s`);
  }
  yield* installMenuPage(retailOf(name), port).pipe(Effect.mapError((failure) => new LanFailure({ problem: failure.message })));
  log(`${name}: menu page reports to 127.0.0.1:${port}`);
});

// Proton rewrites its DXVK and NVIDIA DLLs in a client's prefix on every launch, which breaks their links, so a pair's pool links them again once the pair's games are gone.
export const relinkPairPrefixes = (pair: number) => Effect.forEach(PAIR_SIDES, (side) => {
  const name = clientName(pair, side);
  const base = prefixBase(name);
  return base === undefined || !existsSync(installOf(name))
    ? Effect.void
    : linkPrefix(installOf(base), installOf(name)).pipe(Effect.ignore);
}, { discard: true });
