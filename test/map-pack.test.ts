import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { generateMDX, parseMDL, parseMDX } from "../vendor/war3-model.mjs";
import { ensurePackager } from "../scripts/wisp/mapBuild";

const build = join(import.meta.dir, "../build");
mkdirSync(build, { recursive: true });
const work = mkdtempSync(join(build, "map-pack-"));


function regression(): string {
  const prefix = process.env.STORMLIB_PREFIX ?? (() => {
    const result = Bun.spawnSync(["nix", "build", "--no-link", "--print-out-paths", "nixpkgs#stormlib"]);
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  })();
  const binary = join(work, "regression");
  const compiler = process.env.CC === undefined ? ["nix", "shell", "nixpkgs#gcc", "--command", "gcc"] : [process.env.CC];
  const compiled = Bun.spawnSync([...compiler, `-I${prefix}/include`, join(import.meta.dir, "../native/map-pack.test.c"),
    `-L${prefix}/lib`, `-Wl,-rpath,${prefix}/lib`, "-lstorm", "-o", binary]);
  expect({ code: compiled.exitCode, stderr: compiled.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  return binary;
}


function fullArchive(name: string): { readonly archive: string; readonly existing: string } {
  const existing = join(work, `${name}.txt`);
  writeFileSync(existing, "synthetic archive contents");
  const archive = join(work, `${name}.mpq`);
  const result = Bun.spawnSync([regression(), archive, existing]);
  expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  expect(result.stdout.toString()).toContain("existing entries preserved");
  return { archive, existing };
}

test("[repro 51dbdf4] the native packager grows a full MPQ and preserves existing entries", () => {
  fullArchive("single");
});


const clip = () => new Uint8Array(generateMDX(parseMDL(`Version { FormatVersion 800, }
Model "Clip" { NumGeosets 1, NumBones 2, BlendTime 150, MinimumExtent { 0, 0, 0 }, MaximumExtent { 10, 10, 20 }, BoundsRadius 12, }
Sequences 1 { Anim "Attack Slam" { Interval { 3000, 3800 }, NonLooping, MinimumExtent { 0, 0, 0 }, MaximumExtent { 10, 10, 20 }, BoundsRadius 12, } }
Textures 2 { Bitmap { Image "", ReplaceableId 1, } Bitmap { Image "war3mapImported\\Portrait.tga", } }
Materials 1 { Material { Layer { FilterMode None, static TextureID 0, } Layer { FilterMode Blend, static TextureID 1, } } }
Geoset {
  Vertices 3 { { 0, 0, 0 }, { 10, 0, 0 }, { 0, 10, 20 }, }
  Normals 3 { { 0, 0, 1 }, { 0, 0, 1 }, { 0, 0, 1 }, }
  TVertices 3 { { 0, 0 }, { 1, 0 }, { 0, 1 }, }
  VertexGroup { 0, 0, 1, }
  Faces 1 3 { Triangles { { 0, 1, 2 }, } }
  Groups 2 2 { Matrices { 0 }, Matrices { 1 }, }
  MinimumExtent { 0, 0, 0 }, MaximumExtent { 10, 10, 20 }, BoundsRadius 12,
  MaterialID 0,
  SelectionGroup 0,
}
Bone "Root" { ObjectId 0, GeosetId 0, GeosetAnimId None, Translation 2 { Linear, 3000: { 0, 0, 0 }, 3800: { 0, 0, 40 }, } }
Bone "Hand" { ObjectId 1, Parent 0, GeosetId 0, GeosetAnimId None, Rotation 2 { Linear, 3000: { 0, 0, 0, 1 }, 3800: { 0, 0, 0.7071, 0.7071 }, } }
PivotPoints 2 { { 0, 0, 0 }, { 0, 0, 10 }, }
`)));


function portrait(): Uint8Array {
  const pixels = 16;
  const bytes = new Uint8Array(18 + pixels * 4);
  bytes[2] = 2;
  bytes[12] = 4;
  bytes[14] = 4;
  bytes[16] = 32;
  bytes[17] = 8;
  for (let i = 0; i < pixels; i++) bytes.set([0, 3, 255, i * 17], 18 + i * 4);
  return bytes;
}


function blp(): Uint8Array {
  const bytes = new Uint8Array(156 + 1024 + 32);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("BLP1"));
  view.setUint32(4, 1, true);
  view.setUint32(8, 8, true);
  view.setUint32(12, 4, true);
  view.setUint32(16, 4, true);
  view.setUint32(20, 4, true);
  view.setUint32(28, 156 + 1024, true);
  view.setUint32(28 + 64, 32, true);
  for (let i = 0; i < 256; i++) view.setUint32(156 + i * 4, (i << 16) | 0xff, true);
  for (let i = 0; i < 16; i++) {
    bytes[156 + 1024 + i] = i;
    bytes[156 + 1024 + 16 + i] = 255 - i * 17;
  }
  return bytes;
}

test("[invariant] listed entries are packaged and extracted in one archive opening, byte for byte, keeping clip and texture facts", async () => {
  const { archive, existing } = fullArchive("listed");
  const packager = join(work, "map-pack");
  await Effect.runPromise(ensurePackager(packager));
  const files = { clip: clip(), portrait: portrait(), blp: blp(), "tone.ogg": readFileSync(join(import.meta.dir, "fixtures/tone.ogg")) };
  const entries: { readonly entry: string; readonly source: string }[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    const source = join(work, name);
    writeFileSync(source, bytes);

    for (let copy = 0; copy < 8; copy++) entries.push({ entry: `war3mapImported\\${name === "tone.ogg" ? `tone-${copy}.ogg` : `${name}-${copy}`}`, source });
  }
  const override = join(work, "override");
  writeFileSync(override, "later entries win");
  entries.push({ entry: "war3mapImported\\clip-0", source: override });
  const list = (rows: readonly { readonly entry: string; readonly source: string }[]) => rows.map(({ entry, source }) => `${source}\t${entry}\n`).join("");
  writeFileSync(join(work, "replace.list"), list(entries));
  const replaced = Bun.spawnSync([packager, "replace-list", archive, join(work, "replace.list")]);
  expect({ code: replaced.exitCode, stderr: replaced.stderr.toString() }).toEqual({ code: 0, stderr: "" });

  const wanted = [...new Map([...entries, { entry: "existing-0.txt", source: existing }].map((row) => [row.entry, row.source]))];
  const extracted = wanted.map(([entry], index) => ({ entry, source: join(work, `out-${index}`) }));
  writeFileSync(join(work, "extract.list"), list(extracted));
  const read = Bun.spawnSync([packager, "extract-list", archive, join(work, "extract.list")]);
  expect({ code: read.exitCode, stderr: read.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  for (const [index, [, source]] of wanted.entries()) expect(readFileSync(join(work, `out-${index}`))).toEqual(readFileSync(source));

  const model = parseMDX(readFileSync(extracted.find(({ entry }) => entry.endsWith("clip-1"))!.source).buffer as ArrayBuffer);
  expect(model.Sequences.map(({ Name, Interval }) => [Name, [...Interval]])).toEqual([["Attack Slam", [3000, 3800]]]);
  expect(model.Bones.map(({ Name, Parent }) => [Name, Parent ?? null])).toEqual([["Root", null], ["Hand", 0]]);
  expect(model.Textures.map(({ Image, ReplaceableId }) => [Image, ReplaceableId])).toEqual([["", 1], ["war3mapImported\\Portrait.tga", 0]]);
  expect(model.Materials[0]!.Layers.map(({ TextureID }) => TextureID)).toEqual([0, 1]);
  const tga = readFileSync(extracted.find(({ entry }) => entry.endsWith("portrait-7"))!.source);
  expect([tga[16], tga[17]! & 15, tga[18 + 15 * 4 + 3], tga[18 + 2]]).toEqual([32, 8, 255, 255]);
  const texture = readFileSync(extracted.find(({ entry }) => entry.endsWith("blp-3"))!.source);
  expect([texture.readUInt32LE(8), texture[156 + 1024 + 16]]).toEqual([8, 255]);
});
