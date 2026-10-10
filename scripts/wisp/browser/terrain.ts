import { parseMDX } from "../../../vendor/war3-model.mjs";
import { CELL, type Terrain } from "../terrain";
import { terrainCells, terrainRows, type TerrainCell } from "../terrainMesh";
import { terrainTileLayers, terrainTileUV, terrainBlightPath } from "../terrainTiles";
import { cliffGround, cliffShape } from "../terrainCliffs";
import { linkProgram } from "./gl";

type TextureReader = (path: string) => Promise<HTMLCanvasElement>;
type AssetReader = (path: string) => Promise<ArrayBuffer>;
interface Batch { texture: WebGLTexture; buffer: WebGLBuffer; count: number }
interface Prepared { program: WebGLProgram; vao: WebGLVertexArrayObject; batches: Batch[] }
const prepared = new Map<string, Promise<Prepared>>();

function program(gl: WebGL2RenderingContext): WebGLProgram {
  return linkProgram(gl, "terrain", `#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec2 uv;
uniform mat4 view, projection;
out vec2 texcoord;
void main(){texcoord=uv;gl_Position=projection*view*vec4(position,1.0);}`, `#version 300 es
precision highp float;
in vec2 texcoord;
uniform sampler2D tile;
out vec4 color;
void main(){color=texture(tile,texcoord);if(color.a<0.01)discard;}`);
}
function ground(cell: TerrainCell, uv: readonly [number, number, number, number]): number[] {
  const [u0, v0, u1, v1] = uv, vertices = cell.corners.map((point, corner) => [cell.x + (corner % 2) * CELL, cell.y + Math.floor(corner / 2) * CELL, point.height, corner % 2 === 0 ? u0 : u1, corner < 2 ? v1 : v0]);
  return [0, 1, 2, 1, 3, 2].flatMap(index => vertices[index] ?? []);
}
async function prepare(gl: WebGL2RenderingContext, terrain: Terrain, readTexture: TextureReader, readAsset: AssetReader): Promise<Prepared> {
  const groundRows = terrainRows(new Uint8Array(await readAsset("TerrainArt\\Terrain.slk")));
  const cliffRows = terrain.cliffTiles.length === 0 ? new Map<string, Readonly<Record<string, string>>>() : terrainRows(new Uint8Array(await readAsset("TerrainArt\\CliffTypes.slk")));
  terrain = cliffGround(terrain, cliffRows);
  const blightPath = terrain.points.some(point => (point.flags & 2) !== 0)
    ? terrainBlightPath(new Uint8Array(await readAsset("UI\\WorldEditData.txt")), terrain.tileset) : undefined;
  const meshes = new Map<string, { texture: HTMLCanvasElement; vertices: number[]; order: number }>();
  const textures = new Map<string, HTMLCanvasElement>();
  const texture = async (path: string) => {
    let value = textures.get(path);
    if (value === undefined) { value = await readTexture(path); textures.set(path, value); }
    return value;
  };
  const add = (path: string, image: HTMLCanvasElement, order: number, vertices: number[]) => {
    const key = `${order}:${path}`;
    let mesh = meshes.get(key);
    if (mesh === undefined) meshes.set(key, mesh = { texture: image, vertices: [], order });
    for (const vertex of vertices) mesh.vertices.push(vertex);
  };
  for (const cell of terrainCells(terrain)) {
    const levels = cell.corners.map(point => point.layer), low = Math.min(...levels);
    const shape = cliffShape(cell);
    if (shape !== undefined) {
      const cliff = cell.corners.find(point => point.cliff !== 15)?.cliff ?? 0;
      const id = terrain.cliffTiles[cliff], row = id === undefined ? undefined : cliffRows.get(id);
      if (row === undefined) throw new Error(`no installed CliffTypes.slk row for ${id ?? cliff}`);
      const prefix = row.cliffmodeldir;
      if (prefix === undefined || prefix === "_") throw new Error(`no cliff model directory for ${id}`);
      const variation = cell.corners[0].cliffVariation;
      const path = `Doodads\\Terrain\\${prefix}\\${prefix}${shape}${variation}.mdx`;
      const model = parseMDX(await readAsset(path));
      const texPath = `${row.texdir}\\${row.texfile}.blp`, image = await texture(texPath);
      for (const geoset of model.Geosets) {
        const vertices: number[] = [], coords = geoset.TVertices[0];
        for (const index of geoset.Faces) {
          const x = geoset.Vertices[index * 3] ?? 0, y = geoset.Vertices[index * 3 + 1] ?? 0;
          const east = 1 + x / CELL, north = 1 - y / CELL;
          const heights = cell.corners.map(point => point.height - (point.layer - 2) * CELL);
          const south = (heights[0] ?? 0) * (1 - east) + (heights[1] ?? 0) * east;
          const top = (heights[2] ?? 0) * (1 - east) + (heights[3] ?? 0) * east;
          vertices.push(cell.x + CELL + x, cell.y + CELL - y, (geoset.Vertices[index * 3 + 2] ?? 0) + (low - 2) * CELL + south * (1 - north) + top * north, coords?.[index * 2] ?? 0, coords?.[index * 2 + 1] ?? 0);
        }
        add(texPath, image, -1, vertices);
      }
      continue;
    }
    for (const layer of terrainTileLayers(cell.corners)) {
      let path: string, order: number;
      if (layer.tile === "blight") {
        if (blightPath === undefined) throw new Error("blighted terrain has no installed texture path");
        path = blightPath; order = terrain.groundTiles.length;
      } else {
        const id = terrain.groundTiles[layer.tile], row = id === undefined ? undefined : groundRows.get(id);
        if (row === undefined) throw new Error(`no installed Terrain.slk row for ${id ?? layer.tile}`);
        path = `${row.dir}\\${row.file}.blp`; order = layer.tile;
      }
      const image = await texture(path);
      add(path, image, order, ground(cell, terrainTileUV(image.width, image.height, layer.mask, layer.variation)));
    }
  }
  const batches: Batch[] = [];
  for (const mesh of [...meshes.values()].sort((a, b) => a.order - b.order)) {
    const buffer = gl.createBuffer(), tile = gl.createTexture();
    if (buffer === null || tile === null) throw new Error("cannot allocate terrain mesh");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.vertices), gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, tile); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mesh.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    batches.push({ texture: tile, buffer, count: mesh.vertices.length / 5 });
  }
  const vao = gl.createVertexArray();
  if (vao === null) throw new Error("cannot allocate terrain vertex array");
  return { program: program(gl), vao, batches };
}

export async function drawTerrain(gl: WebGL2RenderingContext, terrain: Terrain, view: Float32Array, projection: Float32Array, readTexture: TextureReader, readAsset: AssetReader): Promise<void> {
  const key = JSON.stringify(terrain);
  let loading = prepared.get(key);
  if (loading === undefined) prepared.set(key, loading = prepare(gl, terrain, readTexture, readAsset));
  const scene = await loading;
  gl.useProgram(scene.program); gl.bindVertexArray(scene.vao);
  gl.uniformMatrix4fv(gl.getUniformLocation(scene.program, "view"), false, view); gl.uniformMatrix4fv(gl.getUniformLocation(scene.program, "projection"), false, projection);
  gl.uniform1i(gl.getUniformLocation(scene.program, "tile"), 0);
  gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.activeTexture(gl.TEXTURE0);
  for (const batch of scene.batches) {
    gl.bindTexture(gl.TEXTURE_2D, batch.texture); gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.drawArrays(gl.TRIANGLES, 0, batch.count);
  }
  gl.bindVertexArray(null);
}
