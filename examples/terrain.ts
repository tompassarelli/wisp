import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, FileSystem } from "effect";
import { decodeTerrain } from "../scripts/wisp/terrain";
import { terrainLine, terrainRectFill } from "../scripts/wisp/terrainAuthor";

/** Original synthetic grid; BASE and PATH have no installed art. */
export function syntheticTerrain(version = 11): Uint8Array {
  const size = version === 12 ? 8 : 7;
  const bytes = new Uint8Array(45 + 48 * size), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("W3E!"));
  view.setInt32(4, version, true); bytes[8] = 76;
  view.setInt32(9, 1, true); view.setInt32(13, 2, true);
  bytes.set(new TextEncoder().encode("BASEPATH"), 17);
  view.setInt32(29, 8, true); view.setInt32(33, 6, true);
  view.setFloat32(37, -448, true); view.setFloat32(41, -320, true);
  for (let i = 0; i < 48; i++) {
    const at = 45 + i * size;
    view.setInt16(at, 0x2000 + i, true); view.setUint16(at + 2, 0x6000 + i, true);
    if (version === 12) view.setUint16(at + 4, 0xa580, true);
    else bytes[at + 4] = 0xa0;
    bytes[at + size - 2] = 0x67; bytes[at + size - 1] = 2;
  }
  return bytes;
}

export function terrainExample(version = 11): Uint8Array {
  return terrainRectFill(terrainLine(syntheticTerrain(version), "PATH", [0, 0], [7, 3]), "PATH", [2, 4], [5, 5]);
}

if (import.meta.main) BunRuntime.runMain(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const output = process.argv[2] ?? "build/terrain-example/war3map.w3e";
  const bytes = terrainExample();
  yield* fs.makeDirectory(output.substring(0, output.lastIndexOf("/")) || ".", { recursive: true });
  yield* fs.writeFile(output, bytes);
  yield* Effect.log(`${output}: ${decodeTerrain(bytes).points.filter(point => point.ground === 1).length} PATH points, 32 unchanged BASE points`);
}).pipe(Effect.provide(BunServices.layer)));
