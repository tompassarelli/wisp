// Headless runs in 32-bit Lua (wisp:docs/headless.md): each simulated client
// loads the map's compiled bundle into its own environment, whose globals are
// that client's natives over Lua's own, so clients share no state.
import type { ClientScope, LocalNatives, MapEntry } from "./client";
import type { FrameTemplate } from "./frames";
import type { SyncDelivery } from "./lockstep";
import { parseNativeDeclarations } from "./declarations";
import { type Journey, journeyLines, journeyProblems, runJourney } from "./journey";
import { Lockstep } from "./lockstep";
import { bundleModules } from "../runtime/modules";
import { stringChecksum } from "../platform/payloadChecksum";

/** What a game declares about its map for a headless run. */
export interface LuaHeadlessMap {
  /** The map's configureRuntime() filePrefix. */
  readonly filePrefix: string;
  readonly localNatives?: LocalNatives;
  /** Human player slots, one client each; two by default. */
  readonly players?: readonly number[];
  /** Frame definitions (wisp:docs/ui.md) whose trees BlzCreateFrame makes by name, as their generated FDF does in Warcraft. */
  readonly frames?: readonly FrameTemplate[];
}

/** A file's bytes, for a host program running in Lua. */
export function readFile(path: string): string {
  const [file, problem] = io.open(path, "rb");
  if (file === undefined) throw new Error(`can't read ${path}: ${problem}`);
  const text = file.read("a");
  file.close();
  if (text === undefined) throw new Error(`can't read ${path}`);
  return text;
}

/**
 * Clients that each run `bundle`, the map's compiled Lua, with the natives
 * `declarations` (warcraft.d.ts) lists; `scope` sees each client run, and
 * `delivery` delays synchronized messages as Warcraft does.
 */
export function luaLockstep(map: LuaHeadlessMap, bundle: string, declarations: string, scope?: ClientScope, delivery?: SyncDelivery): Lockstep {
  return new Lockstep({
    ...(scope === undefined ? {} : { scope }),
    ...(delivery === undefined ? {} : { delivery }),
    declarations: parseNativeDeclarations(declarations),
    players: map.players ?? [0, 1],
    filePrefix: map.filePrefix,
    // A reload publishes the whole bundle as one module.
    modules: bundleModules(bundle),
    hash: stringChecksum,
    ...(map.localNatives === undefined ? {} : { localNatives: map.localNatives }),
    ...(map.frames === undefined ? {} : { frames: map.frames }),
    natives: (client) => {
      const environment = client.natives;
      setmetatable(environment, { __index: _G });
      // TypeScriptToLua's globalThis is _G; a hot reload loads its bundle here too.
      return { _G: environment, load: (text: string, name?: string) => load(text, name, "t", environment) };
    },
    entry: (client) => {
      const [chunk, problem] = load(bundle, "=map", "t", client.natives);
      if (chunk === undefined) throw new Error(`the map bundle doesn't load: ${problem}`);
      const entry: MapEntry = chunk();
      return entry;
    },
  });
}

/** Plays `journey` with the bundle and declarations at these paths, prints its result, and returns how many problems it found. */
export function runLuaJourney(map: LuaHeadlessMap, journey: Journey, bundlePath: string, declarationsPath: string): number {
  const result = runJourney(luaLockstep(map, readFile(bundlePath), readFile(declarationsPath)), journey);
  for (const line of journeyLines(result)) print(line);
  return journeyProblems(result);
}
