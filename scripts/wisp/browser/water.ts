import type { Terrain } from "../terrain";
import { terrainRows } from "../terrainMesh";
import { waterMesh, waterTable, waterTexture, type WaterTable } from "../water";
import { linkProgram } from "./gl";

type TextureReader = (path: string) => Promise<HTMLCanvasElement>;
type AssetReader = (path: string) => Promise<ArrayBuffer>;

export interface WaterFog {
  readonly color: readonly number[];
  readonly start: number;
  readonly end: number;
  readonly max: number;
  readonly height?: { readonly bottom: number; readonly top: number; readonly start: number; readonly end: number };
}
interface Prepared { program: WebGLProgram; vao: WebGLVertexArrayObject; buffer: WebGLBuffer; count: number; table: WaterTable }
const prepared = new Map<string, Promise<Prepared | undefined>>();
const frames = new Map<string, Promise<WebGLTexture>>();

function program(gl: WebGL2RenderingContext): WebGLProgram {
  return linkProgram(gl, "water", `#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec2 uv;
layout(location=2) in vec4 tint;
uniform mat4 view, projection;
out vec2 texcoord; out vec4 shade; out float depth; out float height;
void main(){vec4 eye=view*vec4(position,1.0);texcoord=uv;shade=tint;depth=-eye.z;height=position.z;gl_Position=projection*eye;}`, `#version 300 es
precision highp float;
in vec2 texcoord; in vec4 shade; in float depth; in float height;
uniform sampler2D surface;
uniform vec4 fogColor; uniform vec3 fogRange; uniform vec4 heightFog; uniform float heightFogOn;
out vec4 color;
void main(){
  color=texture(surface,texcoord)*shade;
  color.rgb=mix(pow((max(color.rgb,0.0)+0.055)/1.055,vec3(2.4)),color.rgb/12.92,lessThanEqual(color.rgb,vec3(0.04045)));
  if(fogColor.w>0.5){
    float fog=clamp((depth-fogRange.x)/max(fogRange.y-fogRange.x,1.0),0.0,fogRange.z);
    if(heightFogOn>0.5){
      float below=clamp((heightFog.y-height)/max(heightFog.y-heightFog.x,1.0),0.0,1.0);
      float reach=clamp((depth-heightFog.z)/max(heightFog.w-heightFog.z,1.0),0.0,1.0);
      fog=1.0-(1.0-fog)*(1.0-below*reach);
    }
    vec3 fogLinear=mix(pow((max(fogColor.rgb,0.0)+0.055)/1.055,vec3(2.4)),fogColor.rgb/12.92,lessThanEqual(fogColor.rgb,vec3(0.04045)));
    color.rgb=mix(color.rgb,fogLinear,fog);
  }
  if(color.a<0.004)discard;
}`);
}
async function prepare(gl: WebGL2RenderingContext, terrain: Terrain, readAsset: AssetReader): Promise<Prepared | undefined> {
  if (!terrain.points.some((point) => (point.flags & 4) !== 0)) return undefined;
  const table = waterTable(terrainRows(new Uint8Array(await readAsset("TerrainArt\\Water.slk"))), terrain.tileset);
  const vertices = waterMesh(terrain, table);
  const buffer = gl.createBuffer(), vao = gl.createVertexArray();
  if (buffer === null || vao === null) throw new Error("cannot allocate water mesh");
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 20);
  gl.bindVertexArray(null);
  return { program: program(gl), vao, buffer, count: vertices.length / 9, table };
}
function frameTexture(gl: WebGL2RenderingContext, path: string, readTexture: TextureReader): Promise<WebGLTexture> {
  let loading = frames.get(path);
  if (loading === undefined) frames.set(path, loading = readTexture(path).then((image) => {
    const texture = gl.createTexture();
    if (texture === null) throw new Error("cannot allocate water texture");
    gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return texture;
  }));
  return loading;
}

export async function drawWater(gl: WebGL2RenderingContext, terrain: Terrain, frame: number, view: Float32Array, projection: Float32Array, fog: WaterFog | undefined, readTexture: TextureReader, readAsset: AssetReader): Promise<boolean> {
  const key = JSON.stringify(terrain);
  let loading = prepared.get(key);
  if (loading === undefined) prepared.set(key, loading = prepare(gl, terrain, readAsset));
  const scene = await loading;
  if (scene === undefined || scene.count === 0) return false;
  const texture = await frameTexture(gl, waterTexture(scene.table, frame), readTexture);
  const at = (name: string) => gl.getUniformLocation(scene.program, name);
  gl.useProgram(scene.program); gl.bindVertexArray(scene.vao);
  gl.uniformMatrix4fv(at("view"), false, view); gl.uniformMatrix4fv(at("projection"), false, projection);
  gl.uniform1i(at("surface"), 0);
  gl.uniform4f(at("fogColor"), fog?.color[0] ?? 0, fog?.color[1] ?? 0, fog?.color[2] ?? 0, fog === undefined ? 0 : 1);
  gl.uniform3f(at("fogRange"), fog?.start ?? 0, fog?.end ?? 1, fog?.max ?? 1);
  gl.uniform1f(at("heightFogOn"), fog?.height === undefined ? 0 : 1);
  gl.uniform4f(at("heightFog"), fog?.height?.bottom ?? 0, fog?.height?.top ?? 1, fog?.height?.start ?? 0, fog?.height?.end ?? 1);
  gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.drawArrays(gl.TRIANGLES, 0, scene.count);
  gl.depthMask(true); gl.bindVertexArray(null);
  return true;
}
