import { NO_BASE, PAYLOAD_FILE_BYTES, deltaFile, payloadFile } from "./gameFiles";
import { ModulePublisher, type ModuleSet, moduleChunk, parsePayload, payloadPieces, textChecksum } from "./modules";
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

test("[invariant] modules: once a state is installed, a version's delta carries only modules that differ from it", () => {
  const publisher = new ModulePublisher("fx");
  const first = publisher.files(1, set([["main", "return 1"], ["a", "return 2"], ["b", "return 3"]]));
  assertEquals(first.manifest.base, NO_BASE);
  assertEquals(first.manifest.changes, 0);
  assertEquals(first.payloads.length, 1);
  assertEquals(first.payloads[0]?.[0], payloadFile(first.manifest.state, 0, "fx"));
  assertEquals(first.manifest.state, textChecksum(parsePayload(first.payloads[0]?.[1] ?? "")?.index ?? ""));

  publisher.installed(first.published);
  const changed = set([["main", "return 1"], ["a", "return 20"], ["b", "return 3"]]);
  const second = publisher.files(2, changed);
  assertEquals(second.manifest.base, first.manifest.state);
  assertEquals(second.manifest.changes, 1);
  assertEquals(second.changed.join(","), "a");
  const delta = parsePayload(published(second.payloads, deltaFile(second.manifest.state, first.manifest.state, 0, "fx")) ?? "");
  assertEquals(names(delta?.hashes ?? []), "main,a,b");
  assertEquals(delta?.texts.a, moduleChunk("return 20"));
  assertEquals(delta?.texts.main, undefined);
  const full = parsePayload(published(second.payloads, payloadFile(second.manifest.state, 0, "fx")) ?? "");
  assertEquals(full?.texts.main, moduleChunk("return 1"));

  assertEquals(new ModulePublisher("fx").files(7, changed).manifest.state, second.manifest.state);


  const third = publisher.files(3, set([["main", "return 1"], ["renamed", "return 20"]]));
  const renamed = parsePayload(published(third.payloads, deltaFile(third.manifest.state, first.manifest.state, 0, "fx")) ?? "");
  assertEquals(names(renamed?.hashes ?? []), "main,renamed");
  assertEquals(renamed?.texts.renamed, moduleChunk("return 20"));
  assertEquals(renamed?.texts.main, undefined);
});
