import { NO_BASE, PAYLOAD_FILE_BYTES, deltaFile, payloadFile } from "./gameFiles";
import { floorMod } from "../sim/intMath";
import { ModulePublisher, type ModuleSet, type ModuleState, moduleChunk, parsePayload, payloadPieces, textChecksum } from "./modules";
import { assertEquals, assertTrue, test } from "./testing";

const set = (codes: readonly (readonly [string, string])[]): ModuleSet => ({
  entry: codes[0]?.[0] ?? "",
  modules: codes.map(([name, code]) => ({ name, text: moduleChunk(code) })),
});

const names = (pairs: readonly (readonly [string, string])[]) => pairs.map(([name]) => name).join(",");

function published(files: readonly (readonly [string, string])[], path: string): string | undefined {
  for (const [name, text] of files) if (name === path) return text;
  return undefined;
}

test("[invariant] modules: payload pieces join back and never split a multi-byte character", () => {
  const high = String.fromCharCode(0xc3);
  const text = `${"a".repeat(PAYLOAD_FILE_BYTES - 2)}${high.repeat(5)}${"b".repeat(PAYLOAD_FILE_BYTES)}`;
  const pieces = payloadPieces(text);
  assertEquals(pieces.length, 3);
  assertEquals(pieces.join(""), text);
  for (const piece of pieces) {
    assertTrue(piece.length <= PAYLOAD_FILE_BYTES);
    assertTrue(piece.charCodeAt(0) < 0x80);
  }
});

test("[property seed 31] modules: once a state is installed, a version's delta carries exactly the modules that differ from it, and any publisher names a set's state alike", () => {
  let seed = 31;
  const next = (below: number) => {
    seed = floorMod(seed * 75 + 74, 65537);
    return floorMod(seed, below);
  };
  const publisher = new ModulePublisher("fx");
  let installed: ModuleState | undefined;
  let installedTexts: Record<string, string | undefined> = {};
  for (let version = 1; version <= 60; version++) {
    const codes: [string, string][] = [["main", `return ${next(3)}`]];
    for (const name of ["a", "b", "renamed"]) if (next(2) === 0) codes.push([name, `return ${next(3)}`]);
    const files = publisher.files(version, set(codes));
    const at = `version ${version}`;
    assertEquals(files.manifest.state, new ModulePublisher("fx").files(version + 100, set(codes)).manifest.state, `${at} state`);
    const full = parsePayload(published(files.payloads, payloadFile(files.manifest.state, 0, "fx")) ?? "");
    assertEquals(files.manifest.state, textChecksum(full?.index ?? ""), `${at} full index`);
    for (const [name, code] of codes) assertEquals(full?.texts[name], moduleChunk(code), `${at} full ${name}`);
    if (installed === undefined) {
      assertEquals(files.manifest.base, NO_BASE, `${at} base`);
      assertEquals(files.manifest.changes, 0, `${at} changes`);
      assertEquals(files.payloads.length, 1, `${at} payloads`);
    } else {
      assertEquals(files.manifest.base, installed.state, `${at} base`);
      assertEquals(files.manifest.changes, 1, `${at} changes`);
      const differing = codes.filter(([name, code]) => installedTexts[name] !== moduleChunk(code)).map(([name]) => name);
      assertEquals(files.changed.join(","), differing.join(","), `${at} changed`);
      const delta = parsePayload(published(files.payloads, deltaFile(files.manifest.state, installed.state, 0, "fx")) ?? "");
      assertEquals(names(delta?.hashes ?? []), names(codes), `${at} delta index`);
      for (const [name, code] of codes) assertEquals(delta?.texts[name], differing.includes(name) ? moduleChunk(code) : undefined, `${at} delta ${name}`);
    }
    if (next(3) === 0) {
      publisher.installed(files.published);
      installed = files.published;
      installedTexts = {};
      for (const [name, code] of codes) installedTexts[name] = moduleChunk(code);
    }
  }
});
