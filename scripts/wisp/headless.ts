// Headless runs in Bun (wisp:docs/headless.md). The map's TypeScript runs in
// this process: while a simulated client runs, the natives it calls are that
// client's, and the map's own globals (each name starting with one of its
// prefixes) are that client's, so every client keeps its own match state.
// Lua's functions that Wisp's runtime calls (xpcall, pcall, load,
// setmetatable, string.byte) are emulated; a hot reload's `load` returns the
// entry it was published for. Plain functions, so tests use them without Effect.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClientScope, HeadlessClient, LocalNatives, MapEntry, NativeBehaviors } from "../../src/headless/client";
import { type NativeDeclarations, parseNativeDeclarations } from "../../src/headless/declarations";
import { type Journey, journeyLines, journeyProblems, runJourney } from "../../src/headless/journey";
import { Lockstep, type LockstepOptions } from "../../src/headless/lockstep";
import { errorFile } from "../../src/runtime/gameFiles";
import { BUNDLE_MODULE } from "../../src/runtime/modules";
import { sceneFile } from "../../src/runtime/scene";
import { type SceneExpectations, describeScene, readSceneLines, sceneProblems } from "./scene";

/** What a game declares about its map for a headless run. */
export interface HeadlessMap {
  /** The map's configureRuntime() filePrefix. */
  readonly filePrefix: string;
  /** Prefixes of the map's own globals, such as its configureRuntime() globalPrefix. Wisp's `__wisp` is always one. */
  readonly globalPrefixes: readonly string[];
  /** Natives the game's code calls on one client only, each with why that keeps the clients synchronized. */
  readonly localNatives?: LocalNatives;
  /** Natives the default stubs can't answer for this game. */
  readonly natives?: (client: HeadlessClient) => NativeBehaviors;
}

export interface HeadlessRuntime {
  /**
   * Clients of the map whose entry is `entry`, one per player slot, ready to
   * start. `options.delivery`, such as syncDelivery()
   * (wisp:scripts/wisp/syncChannel.ts), makes synchronized messages arrive
   * when it says rather than before the next frame; `options.files` gives a
   * slot's CustomMapData outside the process (customMapData,
   * wisp:scripts/wisp/headlessInput.ts); `options.keepCalls` compares calls
   * every frame and forgets old ones, for long runs.
   */
  clients(entry: MapEntry, players?: readonly number[], options?: Pick<LockstepOptions, "delivery" | "files" | "keepCalls">): Lockstep;
  /** Puts back what the globals held before the runtime was installed. */
  restore(): void;
}

const LUA_GLOBALS = ["xpcall", "pcall", "load", "setmetatable", "string"];

/** The natives this package declares, or those in another warcraft.d.ts. */
export const readNativeDeclarations = (path = join(import.meta.dir, "../../src/natives/warcraft.d.ts")): NativeDeclarations =>
  parseNativeDeclarations(readFileSync(path, "utf8"));

const describeThrown = (error: unknown) => (error instanceof Error ? error.stack ?? error.message : String(error));

/** Lua's functions as Wisp's runtime calls them, for one client. */
function luaFunctions(client: HeadlessClient, bundles: ReadonlyMap<string, MapEntry>): NativeBehaviors {
  return {
    xpcall: (callback: (...args: unknown[]) => unknown, handler: (error: unknown) => unknown, ...args: unknown[]) => {
      try {
        return [true, callback(...args)];
      } catch (error) {
        client.thrown.push(describeThrown(error));
        return [false, handler(error)];
      }
    },
    pcall: (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      try {
        return [true, callback(...args)];
      } catch (error) {
        return [false, error];
      }
    },
    // A published module's chunk: linked against a require, it returns the module, whose value is the entry.
    load: (text: string) => {
      const entry = bundles.get(text);
      return entry === undefined ? [undefined, "not a module this headless run published"] : [() => () => entry];
    },
    setmetatable: (table: object, metatable: object | null) => Object.setPrototypeOf(table, metatable),
    string: {
      byte: (text: string, first: number, last = first) => {
        if (last === first) return text.charCodeAt(first - 1);
        const bytes: number[] = [];
        for (let position = first; position <= last; position++) bytes.push(text.charCodeAt(position - 1));
        return bytes;
      },
    },
  };
}

/**
 * Makes every declared native, constant and global variable a global of this
 * process that reads the running client's. Call once per test file, and
 * restore after its tests.
 */
export function installHeadless(map: HeadlessMap, declarations = readNativeDeclarations()): HeadlessRuntime {
  const prefixes = ["__wisp", ...map.globalPrefixes];
  const names = [
    ...declarations.functions.map(([name]) => name),
    ...declarations.constants.map(([name]) => name),
    ...declarations.variables.map(([name]) => name),
    ...LUA_GLOBALS,
  ];
  const global = globalThis as Record<string, unknown>;
  const before = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const));
  let current: HeadlessClient | undefined;
  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => {
        if (current === undefined) throw new Error(`${name} used outside a simulated client`);
        return current.natives[name];
      },
      // The scene recorder replaces effect natives with its wrappers, in this client only.
      set: (value: unknown) => {
        if (current === undefined) throw new Error(`${name} replaced outside a simulated client`);
        current.natives[name] = value;
      },
    });
  }
  const own = new Map<HeadlessClient, Record<string, unknown>>();
  const scope: ClientScope = {
    enter: (client) => {
      if (current !== undefined) throw new Error(`p${client.slot} can't run inside p${current.slot}`);
      current = client;
      Object.assign(globalThis, own.get(client));
    },
    leave: (client) => {
      current = undefined;
      const globals: Record<string, unknown> = {};
      for (const key of Object.keys(globalThis)) {
        if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
        globals[key] = global[key];
        delete global[key];
      }
      own.set(client, globals);
    },
  };
  const bundles = new Map<string, MapEntry>();
  return {
    clients: (entry, players = [0, 1], options = {}) => {
      // The text of the one module a reload publishes; this runtime's `load` returns the entry for it.
      const bundle = `-- wisp headless bundle ${bundles.size + 1}`;
      bundles.set(bundle, entry);
      return new Lockstep({
        declarations,
        players,
        filePrefix: map.filePrefix,
        entry: () => entry,
        modules: { entry: BUNDLE_MODULE, modules: [{ name: BUNDLE_MODULE, text: bundle }] },
        scope,
        ...options,
        ...(map.localNatives === undefined ? {} : { localNatives: map.localNatives }),
        natives: (client) => ({ ...luaFunctions(client, bundles), ...map.natives?.(client) }),
      });
    },
    restore: () => {
      for (const [name, descriptor] of before) {
        if (descriptor === undefined) delete global[name];
        else Object.defineProperty(globalThis, name, descriptor);
      }
    },
  };
}

export interface HeadlessReport {
  readonly lines: readonly string[];
  readonly problems: number;
}

/**
 * Plays `journey` in `clients` and reports it: each client's native calls and
 * checksum, then every problem: a desync, a hot reload not running, each
 * client's error reports with what the host knows about the throw, and, when
 * the game declares its scene, what a player would see wrong in each client's
 * latest scene report.
 */
export function playHeadless(clients: Lockstep, journey: Journey, filePrefix: string, scene?: SceneExpectations): HeadlessReport {
  const result = runJourney(clients, journey);
  const lines = [...journeyLines(result)];
  let problems = journeyProblems(result);
  for (const client of clients.clients) {
    const report = client.files.get(errorFile(client.slot, filePrefix));
    if (report !== undefined) lines.push(`p${client.slot} error report:`, ...report.map((line) => `  ${line}`));
    for (const thrown of client.thrown) lines.push(`p${client.slot} thrown:`, ...thrown.split("\n").map((line) => `  ${line}`));
    if (scene === undefined) continue;
    const written = client.files.get(sceneFile(client.slot, filePrefix));
    if (written === undefined) {
      problems++;
      lines.push(`p${client.slot} wrote no scene report: does the entry start the scene recorder?`);
      continue;
    }
    const read = readSceneLines(written);
    if ("problem" in read) {
      problems++;
      lines.push(`p${client.slot} scene report line ${read.line}: ${read.problem}`);
      continue;
    }
    lines.push(`p${client.slot} scene: ${describeScene(read, scene)}`);
    for (const { seen, evidence } of sceneProblems(read, scene)) {
      problems++;
      lines.push(`p${client.slot} would see ${seen} (${evidence})`);
    }
  }
  return { lines, problems };
}
