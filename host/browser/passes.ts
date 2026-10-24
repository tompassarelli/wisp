import { linkProgram } from "./gl";
import { cross, type Matrix, multiply, normalize } from "./matrix";


function basis(z: readonly number[]): Matrix {
  const forward = normalize(z), up = Math.abs(forward[2] ?? 0) > 0.99 ? [0, 1, 0] : [0, 0, 1];
  const x = normalize(cross(up, forward)), y = cross(forward, x), out = new Float32Array(16);
  for (let axis = 0; axis < 3; axis++) { out[axis * 4] = x[axis] ?? 0; out[axis * 4 + 1] = y[axis] ?? 0; out[axis * 4 + 2] = forward[axis] ?? 0; }
  out[15] = 1;
  return out;
}
function orthographic(left: number, right: number, bottom: number, top: number, near: number, far: number): Matrix {
  const out = new Float32Array(16);
  out[0] = 2 / (right - left); out[5] = 2 / (top - bottom); out[10] = -2 / (far - near);
  out[12] = -(right + left) / (right - left); out[13] = -(top + bottom) / (top - bottom); out[14] = -(far + near) / (far - near); out[15] = 1;
  return out;
}

export interface ShadowCamera { eye: readonly number[]; right: readonly number[]; up: readonly number[]; back: readonly number[]; tangent: number; aspect: number; near: number; reach: number }

export const SUN_MAP = 4096;

const CASTER_REACH = 6000;

export function sunView(camera: ShadowCamera, toward: readonly number[]) {
  const rotation = basis(toward), corners: number[][] = [];
  for (const depth of [camera.near, camera.reach]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const half = depth * camera.tangent;
    corners.push([0, 1, 2].map((i) => (camera.eye[i] ?? 0) - (camera.back[i] ?? 0) * depth + (camera.right[i] ?? 0) * sx * half + (camera.up[i] ?? 0) * sy * half / camera.aspect));
  }
  const local = corners.map((corner) => [0, 1, 2].map((row) => [0, 1, 2].reduce((sum, axis) => sum + (rotation[axis * 4 + row] ?? 0) * (corner[axis] ?? 0), 0)));
  const min = [0, 1, 2].map((i) => Math.min(...local.map((point) => point[i] ?? 0))), max = [0, 1, 2].map((i) => Math.max(...local.map((point) => point[i] ?? 0)));
  const near = -((max[2] ?? 0) + CASTER_REACH), far = -(min[2] ?? 0);
  const projection = orthographic(min[0] ?? 0, max[0] ?? 0, min[1] ?? 0, max[1] ?? 0, near, far);
  const texelWorld = Math.max((max[0] ?? 0) - (min[0] ?? 0), (max[1] ?? 0) - (min[1] ?? 0)) / SUN_MAP;

  return { view: rotation, projection, viewProjection: multiply(projection, rotation), bias: Math.max(2, 2.5 * texelWorld) / (far - near), texel: 1 / SUN_MAP };
}

export interface DepthTarget { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number }
export function depthTarget(gl: WebGL2RenderingContext, width: number, height: number): DepthTarget {
  const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, width, height);
  for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, name, value);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
  gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("the shadow depth target is incomplete");
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, width, height };
}

export interface SceneTarget { framebuffer: WebGLFramebuffer; resolved: WebGLFramebuffer; color: WebGLTexture; depth: WebGLTexture; width: number; height: number }
function colorTexture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, width, height);
  for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, name, value);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}
export function sceneTarget(gl: WebGL2RenderingContext, width: number, height: number): SceneTarget {
  if (gl.getExtension("EXT_color_buffer_float") === null) throw new Error("the scene target requires EXT_color_buffer_float");
  const colorSamples = Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES) as Int32Array);
  const depthSamples = Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES) as Int32Array);
  const samples = Math.min(4, ...colorSamples.filter(value => depthSamples.includes(value)));
  if (!Number.isFinite(samples)) throw new Error("the scene target requires multisampled RGBA16F colour and depth");
  const framebuffer = gl.createFramebuffer(), colorBuffer = gl.createRenderbuffer(), depthBuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, colorBuffer); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA16F, width, height);
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colorBuffer);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("the scene target is incomplete");
  const color = colorTexture(gl, width, height), depth = depthTarget(gl, width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, depth.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]); gl.readBuffer(gl.COLOR_ATTACHMENT0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("the resolved HDR scene target is incomplete");
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { framebuffer, resolved: depth.framebuffer, color, depth: depth.texture, width, height };
}
export function resolve(gl: WebGL2RenderingContext, target: SceneTarget): void {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.resolved);
  gl.blitFramebuffer(0, 0, target.width, target.height, 0, 0, target.width, target.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.blitFramebuffer(0, 0, target.width, target.height, 0, 0, target.width, target.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}

const QUAD_VS = `#version 300 es
in vec2 position; out vec2 uv;
void main() { uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;
interface Pass { program: WebGLProgram; uniform: (name: string) => WebGLUniformLocation | null }
function pass(gl: WebGL2RenderingContext, fragment: string): Pass {
  const program = linkProgram(gl, "post-processing", QUAD_VS, fragment, ["position"]);
  const locations = new Map<string, WebGLUniformLocation | null>();
  return { program, uniform: (name) => { if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name)); return locations.get(name) ?? null; } };
}

const COMPOSE_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 fragment;
uniform sampler2D scene;
void main() {
  fragment = vec4(clamp(texture(scene, uv).rgb, 0.0, 1.0), 1.0);
}`;

export function postProcessor(gl: WebGL2RenderingContext, target: SceneTarget) {
  const vao = gl.createVertexArray(), buffer = gl.createBuffer();
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const compose = pass(gl, COMPOSE_FS);
  return () => {
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, target.width, target.height);
    gl.useProgram(compose.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, target.color); gl.uniform1i(compose.uniform("scene"), 0);
    gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
    for (let unit = 0; unit < 3; unit++) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  };
}
