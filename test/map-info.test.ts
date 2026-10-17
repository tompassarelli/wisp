import { expect, test } from "bun:test";
import { type MapInfo, declareMap, loadingScreenModel } from "../host/toolchain/mapInfo";

const text = (value: string) => new TextEncoder().encode(`${value}\0`);
const int = (value: number) => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setInt32(0, value, true); return bytes; };
const join = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

const after = join(text("Loading text"), text("Title"), text("Subtitle"), int(2), text("prologue"));
const base: MapInfo = {
  versions: new Uint8Array(28), name: "Base", author: "", description: "", suggestedPlayers: "",
  bounds: new Uint8Array(56), flags: 0, environment: join(new Uint8Array([76]), int(-1), int(128), text(""), after),
  players: [], forces: [], tables: new Uint8Array(0),
};

test("[scenario] a declared loading screen model replaces the preset background and keeps every later field", () => {
  const declared = declareMap(base, "Map", { author: "", description: "", suggestedPlayers: "", players: [], forces: [], loadingScreenModel: "war3mapImported\\Loading.mdx" });
  expect(loadingScreenModel(declared.environment)).toBe("war3mapImported\\Loading.mdx");
  const view = new DataView(declared.environment.buffer, declared.environment.byteOffset);
  expect([declared.environment[0], view.getInt32(1, true), view.getInt32(5, true)]).toEqual([76, -1, -1]);
  expect(declared.environment.subarray(declared.environment.length - after.length)).toEqual(after);
  expect(declareMap(base, "Map", { author: "", description: "", suggestedPlayers: "", players: [], forces: [] }).environment).toEqual(base.environment);
});
