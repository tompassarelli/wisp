






import { readFileSync } from "node:fs";
import type { FrameTemplate } from "../../src/headless/frames";
import type { UnitStateFixtures } from "../../src/headless/client";
import type { SceneryFixtures } from "../../src/headless/warcraft3Scenery";
import type { Warcraft3InventoryFixtures } from "../../src/headless/warcraft3Inventory";
import type { AbilityObjectFixtures } from "../../src/headless/warcraft3Abilities";
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


export interface HeadlessMap {
  readonly abilityObjects?: AbilityObjectFixtures;
  readonly unitStates?: UnitStateFixtures;
  readonly scenery?: SceneryFixtures;
  readonly inventory?: Warcraft3InventoryFixtures;
  readonly playerNames?: Readonly<Record<number, string>>;

  readonly filePrefix: string;

  readonly globalPrefixes: readonly string[];

  readonly localNatives?: LocalNatives;
  readonly intentionalNoops?: IntentionalNoops;

  readonly natives?: (client: HeadlessClient) => NativeBehaviors;




  readonly frames?: readonly FrameTemplate[];
}

export interface HeadlessRuntime {










  clients(entry: MapEntry, players?: readonly number[], options?: Pick<LockstepOptions, "delivery" | "files" | "keepCalls" | "cost" | "effectDeaths" | "musicSlider" | "effectStepMs">): Lockstep;





  modules(entry: MapEntry): ModuleSet;

  restore(): void;
}

const LUA_GLOBALS = ["xpcall", "pcall", "load", "setmetatable", "string", "os"];

const declarationsRead = new Map<string, NativeDeclarations>();


export function readNativeDeclarations(path = join(import.meta.dir, "../../src/natives/warcraft.d.ts")): NativeDeclarations {
  const known = declarationsRead.get(path);
  if (known !== undefined) return known;
  const declarations = parseNativeDeclarations(readFileSync(path, "utf8"));
  declarationsRead.set(path, declarations);
  return declarations;
}

const describeThrown = (error: unknown) => (error instanceof Error ? error.stack ?? error.message : String(error));


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

      set: (value: unknown) => {
        if (current === undefined) throw new Error(`${name} replaced outside a simulated client`);
        current.natives[name] = value;
      },
    });
  }





  const isOwnGlobal = (key: string | symbol): key is string => typeof key === "string" && prefixes.some((prefix) => key.startsWith(prefix));
  const starting: Record<string, unknown> = {};
  for (const key of Object.keys(globalThis).filter(isOwnGlobal)) {
    before.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    starting[key] = global[key];
    delete global[key];
  }

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
        ...(map.abilityObjects === undefined ? {} : { abilityObjects: map.abilityObjects }),
        ...(map.scenery === undefined ? {} : { scenery: map.scenery }),
        ...(map.inventory === undefined ? {} : { inventory: map.inventory }),
        ...(map.playerNames === undefined ? {} : { playerNames: map.playerNames }),
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


export interface HeadlessProject {
  readonly map: HeadlessMap;





  readonly entry: string;

  readonly journeys: Readonly<Record<string, Journey>>;
  readonly scene?: SceneExpectations;
  readonly render?: HeadlessRenderProject;
}


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
