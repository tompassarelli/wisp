import { expect, test } from "bun:test";
import { generateMDX, parseMDL } from "../vendor/war3-model.mjs";
import { parseModelMDX } from "../scripts/wisp/models";
import { FIXTURE_MDL } from "./animation58/models";
import { RULER } from "./animation58/layout";

function rawSkin(modelBytes: ArrayBuffer): ArrayBuffer {
  const input = new Uint8Array(modelBytes), view = new DataView(modelBytes), chunks = [input.slice(0, 4)];
  for (let offset = 4; offset < input.length;) {
    const size = view.getUint32(offset + 4, true), end = offset + 8 + size;
    const tag = new TextDecoder().decode(input.subarray(offset, offset + 4));
    if (tag === "GEOS") {
      const records: Uint8Array[] = [];
      for (let cursor = offset + 8; cursor < end;) {
        const length = view.getUint32(cursor, true), old = input.slice(cursor, cursor + length);
        const skin = Buffer.from(old).indexOf("SKIN"), count = new DataView(old.buffer).getUint32(skin + 4, true);
        const record = new Uint8Array(old.length + count), data = new DataView(record.buffer);
        record.set(old.subarray(0, skin + 8));
        for (let element = 0; element < count; element++) data.setUint16(skin + 8 + element * 2, old[skin + 8 + element] ?? 0, true);
        record.set(old.subarray(skin + 8 + count), skin + 8 + count * 2);
        data.setUint32(0, record.length, true);
        records.push(record); cursor += length;
      }
      const chunk = new Uint8Array(8 + records.reduce((sum, record) => sum + record.length, 0));
      chunk.set(input.subarray(offset, offset + 4)); new DataView(chunk.buffer).setUint32(4, chunk.length - 8, true);
      let at = 8; for (const record of records) { chunk.set(record, at); at += record.length; }
      chunks.push(chunk);
    } else {
      const chunk = input.slice(offset, end);
      if (tag === "VERS") new DataView(chunk.buffer).setUint32(8, 1800, true);
      chunks.push(chunk);
    }
    offset = end;
  }
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0; for (const chunk of chunks) { output.set(chunk, at); at += chunk.length; }
  return output.buffer;
}

test("[reference MDX 1800 layout] raw skin keeps four bone IDs and weights instead of interleaving zero bytes", () => {
  const model = parseMDL(FIXTURE_MDL[RULER] ?? "");
  model.Version = 1100;
  const expected = [0, 1, 0, 0, 128, 127, 0, 0];
  for (const geoset of model.Geosets) {
    geoset.SkinWeights = new Uint8Array(geoset.Vertices.length / 3 * 8);
    for (let vertex = 0; vertex < geoset.Vertices.length / 3; vertex++) geoset.SkinWeights.set(expected, vertex * 8);
  }
  const parsed = parseModelMDX(rawSkin(generateMDX(model)));
  expect(parsed.Version).toBe(1800);
  for (const [index, geoset] of parsed.Geosets.entries()) {
    expect(geoset.Vertices).toEqual(model.Geosets[index]?.Vertices);
    expect(geoset.TVertices).toEqual(model.Geosets[index]?.TVertices);
    expect(Array.from(geoset.SkinWeights?.slice(0, 8) ?? [])).toEqual(expected);
    expect(geoset.SkinWeights?.length).toBe(geoset.Vertices.length / 3 * 8);
  }
});
