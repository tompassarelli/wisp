// Headless runs in Bun (wisp:docs/headless.md). The map's TypeScript runs in
// this process: while a simulated client runs, the natives it calls are that
// client's, and the map's own globals (each name starting with one of its
// prefixes) are that client's, so every client keeps its own match state.
// Lua's functions that Wisp's runtime calls (xpcall, pcall, load,
// setmetatable, string.byte) are emulated; a hot reload's `load` returns the
// entry it was published for. Plain functions, so tests use them without Effect.
import { readFileSync } from "node:fs";
import type { FrameTemplate } from "../../src/headless/frames";
import type { UnitStateFixtures } from "../../src/headless/client";
import type { SceneryFixtures } from "../../src/headless/warcraft3Scenery";
import type { Warcraft3InventoryFixtures } from "../../src/headless/warcraft3Inventory";
import { join } from "node:path";
import type { ClientScope, HeadlessClient, LocalNatives, MapEntry, NativeBehaviors, SoundCue, IntentionalNoops } from "../../src/headless/client";
import type { HeadlessRenderProject } from "./headlessRender";
import { type NativeDeclarations, parseNativeDeclarations } from "../../src/headless/declarations";
import { type Journey, type JourneyOptions, type JourneyResult, journeyLines, journeyProblems, runJourney } from "../../src/headless/journey";
import { Lockstep, type LockstepOptions } from "../../src/headless/lockstep";
import { errorFile } from "../../src/runtime/gameFiles";
import { BUNDLE_MODULE, type ModuleSet } from "../../src/runtime/modules";
import { sceneFile } from "../../src/runtime/scene";
import { type SceneExpectations, describeScene, readSceneLines, sceneProblems } from "./scene";

/** What a game declares about its map for a headless run. */
export interface HeadlessMap {
  readonly unitStates?: UnitStateFixtures;
  readonly scenery?: SceneryFixtures;
  readonly inventory?: Warcraft3InventoryFixtures;
  /** The map's configureRuntime() filePrefix. */
  readonly filePrefix: string;
  /** Prefixes of the map's own globals, such as its configureRuntime() globalPrefix. Wisp's `__wisp` is always one. */
  readonly globalPrefixes: readonly string[];
  /** Natives the game's code calls on one client only, each with why that keeps the clients synchronized. */
  readonly localNatives?: LocalNatives;
  readonly intentionalNoops?: IntentionalNoops;
  /** Natives the default stubs can't answer for this game. */
  readonly natives?: (client: HeadlessClient) => NativeBehaviors;
  /**
   * Frame trees BlzCreateFrame makes by name: frame definitions (wisp:docs/ui.md), as their generated FDF does in
   * Warcraft, or templates such as a TEXT frame's font that the map's own FDF declares.
   */
  readonly frames?: readonly FrameTemplate[];
}

export interface HeadlessRuntime {
  /**
   * Clients of the map whose entry is `entry`, one per player slot, ready to
   * start. `options.delivery`, such as syncDelivery()
   * (wisp:src/headless/syncChannel.ts), makes synchronized messages arrive
   * when it says rather than before the next frame; `options.files` gives a
   * slot's CustomMapData outside the process (customMapData,
   * wisp:scripts/wisp/headlessInput.ts); `options.keepCalls` compares calls
   * every frame and forgets old ones, for long runs; `options.cost` measures
   * each client's frames.
   */
  clients(entry: MapEntry, players?: readonly number[], options?: Pick<LockstepOptions, "delivery" | "files" | "keepCalls" | "cost" | "effectDeaths" | "musicSlider">): Lockstep;
  /**
   * The module set a reload publishes to install `entry`: `reload(modules(entry))`
   * moves the clients to another entry, such as the map loaded again from a
   * copy of its sources with other values, as a real reload's new modules do.
   */
  modules(entry: MapEntry): ModuleSet;
  /** Puts back what the globals held before the runtime was installed. */
  restore(): void;
}

const LUA_GLOBALS = ["xpcall", "pcall", "load", "setmetatable", "string", "os"];

const declarationsRead = new Map<string, NativeDeclarations>();

/** The natives this package declares, or those in another warcraft.d.ts; each file is read once per process. */
export function readNativeDeclarations(path = join(import.meta.dir, "../../src/natives/warcraft.d.ts")): NativeDeclarations {
  const known = declarationsRead.get(path);
  if (known !== undefined) return known;
  const declarations = parseNativeDeclarations(readFileSync(path, "utf8"));
  declarationsRead.set(path, declarations);
  return declarations;
}

const describeThrown = (error: unknown) => (error instanceof Error ? error.stack ?? error.message : String(error));

/** Lua's functions as Wisp's runtime calls them, for one client. */
function luaFunctions(client: HeadlessClient, bundles: ReadonlyMap<string, MapEntry>): NativeBehaviors {
  return {
    os: { clock: () => client.clockSeconds() },
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
  // Each of the map's globals is an accessor of the running client's value,
  // so switching clients moves nothing and the global object keeps its shape.
  // Assigning one that doesn't exist yet reaches the global object's
  // prototype, where a trap makes it an accessor. Globals present now become
  // each client's starting value.
  const isOwnGlobal = (key: string | symbol): key is string => typeof key === "string" && prefixes.some((prefix) => key.startsWith(prefix));
  const starting: Record<string, unknown> = {};
  for (const key of Object.keys(globalThis).filter(isOwnGlobal)) {
    before.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    starting[key] = global[key];
    delete global[key];
  }
  // Weak, so a long run's finished clients take their match state with them.
  const values = new WeakMap<HeadlessClient, Record<string, unknown>>();
  const valuesOf = (client: HeadlessClient) => {
    let own = values.get(client);
    if (own === undefined) values.set(client, own = { ...starting });
    return own;
  };
  const ownNames = new Set<string>();
  const defineOwn = (key: string) => {
    ownNames.add(key);
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      get: () => (current === undefined ? undefined : valuesOf(current)[key]),
      set: (value: unknown) => {
        if (current === undefined) throw new Error(`${key} set outside a simulated client`);
        valuesOf(current)[key] = value;
      },
    });
  };
  for (const key of Object.keys(starting)) defineOwn(key);
  const outerPrototype = Object.getPrototypeOf(globalThis) as object | null;
  Reflect.setPrototypeOf(globalThis, new Proxy(outerPrototype ?? Object.prototype, {
    set: (target, key, value, receiver) => {
      if (receiver !== globalThis || !isOwnGlobal(key)) return Reflect.set(target, key, value, receiver);
      defineOwn(key);
      return Reflect.set(globalThis, key, value);
    },
  }));
  const scope: ClientScope = {
    enter: (client) => {
      if (current !== undefined) throw new Error(`p${client.slot} can't run inside p${current.slot}`);
      current = client;
    },
    leave: () => {
      current = undefined;
    },
  };
  const bundles = new Map<string, MapEntry>();
  const texts = new Map<MapEntry, string>();
  // The text of the one module a reload publishes; this runtime's `load` returns the entry for it.
  const modules = (entry: MapEntry): ModuleSet => {
    let bundle = texts.get(entry);
    if (bundle === undefined) {
      bundle = `-- wisp headless bundle ${bundles.size + 1}`;
      bundles.set(bundle, entry);
      texts.set(entry, bundle);
    }
    return { entry: BUNDLE_MODULE, modules: [{ name: BUNDLE_MODULE, text: bundle }] };
  };
  return {
    modules,
    clients: (entry, players = [0, 1], options = {}) => {
      return new Lockstep({
        declarations,
        players,
        filePrefix: map.filePrefix,
        entry: () => entry,
        modules: modules(entry),
        scope,
        ...options,
        ...(map.localNatives === undefined ? {} : { localNatives: map.localNatives }),
        ...(map.intentionalNoops === undefined ? {} : { intentionalNoops: map.intentionalNoops }),
        ...(map.frames === undefined ? {} : { frames: map.frames }),
        ...(map.unitStates === undefined ? {} : { unitStates: map.unitStates }),
        ...(map.scenery === undefined ? {} : { scenery: map.scenery }),
        ...(map.inventory === undefined ? {} : { inventory: map.inventory }),
        natives: (client) => ({ ...luaFunctions(client, bundles), ...map.natives?.(client) }),
      });
    },
    restore: () => {
      Reflect.setPrototypeOf(globalThis, outerPrototype);
      for (const key of ownNames) delete global[key];
      for (const [name, descriptor] of before) {
        if (descriptor === undefined) delete global[name];
        else Object.defineProperty(globalThis, name, descriptor);
      }
    },
  };
}

/** What a game supplies to play its journeys: its map, its journeys, and its scene when the entry starts the scene recorder. */
export interface HeadlessProject {
  readonly map: HeadlessMap;
  /**
   * The map entry's TypeScript module, exporting start() and install(). It
   * is loaded when a journey plays, so the game's host program never
   * type-checks map code against host globals.
   */
  readonly entry: string;
  /** The first is the default. */
  readonly journeys: Readonly<Record<string, Journey>>;
  readonly scene?: SceneExpectations;
  readonly render?: HeadlessRenderProject;
}

/** The entry module's start() and install(); throws when it has none. */
export async function loadMapEntry(path: string): Promise<MapEntry> {
  const module: unknown = await import(path);
  if (typeof module !== "object" || module === null || !("start" in module) || !("install" in module)) throw new Error(`${path} exports no start() and install()`);
  const { start, install } = module;
  if (typeof start !== "function" || typeof install !== "function") throw new Error(`${path}'s start and install aren't functions`);
  return { start: () => start(), install: () => install() };
}

export interface HeadlessReport {
  readonly lines: readonly string[];
  readonly problems: number;
  readonly frames: number;
  readonly clients: JourneyResult["clients"];
  readonly failures: readonly HeadlessFinding[];
  readonly sounds: readonly (SoundCue & { readonly client: number })[];
}

export interface HeadlessFinding {
  readonly kind: "desync" | "error" | "scene" | "check-fail" | "missing-native";
  readonly frame: number | null;
  readonly client: number | null;
  readonly message: string;
  readonly native?: string;
}

/**
 * Plays `journey` in `clients` and reports it: each client's native calls and
 * checksum, then every problem: a desync, a hot reload not running, each
 * client's error reports with what the host knows about the throw, and, when
 * the game declares its scene, what a player would see wrong in each client's
 * latest scene report.
 */
export function playHeadless(clients: Lockstep, journey: Journey, filePrefix: string, scene?: SceneExpectations, options?: JourneyOptions): HeadlessReport {
  const result = runJourney(clients, journey, options);
  const lines = [...journeyLines(result)];
  let problems = journeyProblems(result);
  const failures: HeadlessFinding[] = [];
  if (result.divergence !== undefined) {
    const frame = /^after frame (\d+),/.exec(result.divergence)?.[1];
    const client = /differs between slot \d+ and slot (\d+):/.exec(result.divergence)?.[1];
    failures.push({ kind: "desync", frame: frame === undefined ? null : Number(frame), client: client === undefined ? null : Number(client), message: result.divergence });
  }
  for (const message of result.reloads) failures.push({ kind: "check-fail", frame: result.frames, client: null, message });
  for (const client of result.clients) {
    for (const message of client.errors) failures.push({ kind: "error", frame: null, client: client.slot, message });
    for (const missing of client.missingNatives) failures.push({ kind: "missing-native", ...missing, message: `unmodeled native ${missing.native}` });
  }
  for (const client of clients.clients) {
    const report = client.files.get(errorFile(client.slot, filePrefix));
    if (report !== undefined) lines.push(`p${client.slot} error report:`, ...report.map((line) => `  ${line}`));
    for (const thrown of client.thrown) lines.push(`p${client.slot} thrown:`, ...thrown.split("\n").map((line) => `  ${line}`));
    if (scene === undefined) continue;
    const written = client.files.get(sceneFile(client.slot, filePrefix));
    if (written === undefined) {
      problems++;
      const message = `p${client.slot} wrote no scene report: does the entry start the scene recorder?`;
      lines.push(message);
      failures.push({ kind: "scene", frame: result.frames, client: client.slot, message });
      continue;
    }
    const read = readSceneLines(written);
    if ("problem" in read) {
      problems++;
      const message = `p${client.slot} scene report line ${read.line}: ${read.problem}`;
      lines.push(message);
      failures.push({ kind: "scene", frame: result.frames, client: client.slot, message });
      continue;
    }
    lines.push(`p${client.slot} scene: ${describeScene(read, scene)}`);
    for (const { seen, evidence } of sceneProblems(read, scene)) {
      problems++;
      const message = `p${client.slot} would see ${seen} (${evidence})`;
      lines.push(message);
      failures.push({ kind: "scene", frame: result.frames, client: client.slot, message });
    }
  }
  const sounds = clients.clients.flatMap((client) => client.soundLog.map((cue) => ({ ...cue, client: client.slot })));
  return { lines, problems, frames: result.frames, clients: result.clients, failures, sounds };
}
