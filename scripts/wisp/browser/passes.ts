type Matrix = Float32Array;

export function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
    out[column * 4 + row] = sum;
  }
  return out;
}
const normalize = (v: readonly number[]): number[] => { const length = Math.hypot(...v) || 1; return v.map((value) => value / length); };
const cross = (a: readonly number[], b: readonly number[]): number[] => [(a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0), (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0), (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0)];
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, i) => sum + value * (b[i] ?? 0), 0);

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
function perspective(tangent: number, near: number, far: number): Matrix {
  const out = new Float32Array(16);
  out[0] = 1 / tangent; out[5] = 1 / tangent; out[10] = (far + near) / (near - far); out[11] = -1; out[14] = 2 * far * near / (near - far);
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

export const POINT_FACE = 1024;
export const POINT_NEAR = 5;
const FACES: readonly (readonly number[])[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export function pointFaces(far: number) {
  const projection = perspective(1, POINT_NEAR, far);

  return FACES.map((axis) => { const view = basis(axis.map((value) => -value)); return { view, projection, viewProjection: multiply(projection, view) }; });
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
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
  for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, name, value);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}
export function sceneTarget(gl: WebGL2RenderingContext, width: number, height: number): SceneTarget {
  const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
  const framebuffer = gl.createFramebuffer(), colorBuffer = gl.createRenderbuffer(), depthBuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, colorBuffer); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height);
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colorBuffer);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("the scene target is incomplete");
  const color = colorTexture(gl, width, height), depth = depthTarget(gl, width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, depth.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]); gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { framebuffer, resolved: depth.framebuffer, color, depth: depth.texture, width, height };
}
export function resolve(gl: WebGL2RenderingContext, target: SceneTarget): void {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.resolved);
  gl.blitFramebuffer(0, 0, target.width, target.height, 0, 0, target.width, target.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.blitFramebuffer(0, 0, target.width, target.height, 0, 0, target.width, target.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}

export type PostProcessing = Readonly<Record<string, Readonly<Record<string, number>>>>;
export function parsePostProcessing(...texts: readonly string[]): PostProcessing {
  const out: Record<string, Record<string, number>> = {};
  for (const text of texts) {
    let section: Record<string, number> | undefined;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim(), header = /^\[(.+)\]$/.exec(line);
      if (header?.[1] !== undefined) { section = out[header[1]] ??= {}; continue; }
      const pair = /^([^=;]+)=(.*)$/.exec(line);
      if (section !== undefined && pair?.[1] !== undefined && pair[2] !== undefined && Number.isFinite(Number(pair[2]))) section[pair[1].trim()] = Number(pair[2]);
    }
  }
  return out;
}

const QUAD_VS = `#version 300 es
in vec2 position; out vec2 uv;
void main() { uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;
interface Pass { program: WebGLProgram; uniform: (name: string) => WebGLUniformLocation | null }
function pass(gl: WebGL2RenderingContext, fragment: string): Pass {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type); if (shader === null) throw new Error("no post-processing shader");
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`post-processing shader: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, QUAD_VS)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, 0, "position"); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`post-processing program: ${gl.getProgramInfoLog(program)}`);
  const locations = new Map<string, WebGLUniformLocation | null>();
  return { program, uniform: (name) => { if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name)); return locations.get(name) ?? null; } };
}

const AO_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 fragment;
uniform sampler2D depthMap; uniform mat4 inverseProjection; uniform vec2 texel; uniform vec2 focal;
uniform float radius, strength, power, clampTo, horizon, fadeMul, fadeAdd;
vec3 at(vec2 p) { float d = texture(depthMap, p).r; vec4 v = inverseProjection * vec4(vec3(p, d) * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
void main() {
  float depth = texture(depthMap, uv).r;
  if (depth >= 1.0) { fragment = vec4(1.0); return; }
  vec3 p = at(uv);
  vec3 l = at(uv - vec2(texel.x, 0.0)), r = at(uv + vec2(texel.x, 0.0)), d = at(uv - vec2(0.0, texel.y)), u = at(uv + vec2(0.0, texel.y));
  vec3 dx = abs(r.z - p.z) < abs(p.z - l.z) ? r - p : p - l, dy = abs(u.z - p.z) < abs(p.z - d.z) ? u - p : p - d;
  vec3 n = normalize(cross(dx, dy));
  float screen = radius * focal.y / max(-p.z, 1.0);
  float sum = 0.0;
  const int COUNT = 16;
  float spin = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  for (int i = 0; i < COUNT; i++) {
    float t = (float(i) + 0.5) / float(COUNT), angle = spin + float(i) * 2.39996323;
    vec2 offset = vec2(cos(angle), sin(angle)) * sqrt(t) * max(screen, 1.0) * texel;
    vec3 v = at(uv + offset) - p;
    float distance2 = dot(v, v);
    float falloff = clamp(1.0 - distance2 / (radius * radius), 0.0, 1.0);
    float cosine = dot(n, v) * inversesqrt(max(distance2, 1e-6));
    sum += clamp(cosine - horizon, 0.0, 1.0) * falloff;
  }
  float obscurance = sum / float(COUNT) * strength * clamp(-p.z * fadeMul + fadeAdd, 0.0, 1.0);
  fragment = vec4(vec3(pow(clamp(1.0 - min(obscurance, clampTo), 0.0, 1.0), power)), 1.0);
}`;

const AO_BLUR_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 fragment;
uniform sampler2D occlusion; uniform sampler2D depthMap; uniform vec2 texel;
void main() {
  float centre = texture(depthMap, uv).r, sum = 0.0, weights = 0.0;
  for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
    vec2 p = uv + vec2(float(x), float(y)) * texel;
    float w = 1.0 / (1.0 + abs(texture(depthMap, p).r - centre) * 4000.0);
    sum += texture(occlusion, p).r * w; weights += w;
  }
  fragment = vec4(vec3(sum / weights), 1.0);
}`;

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 fragment;
uniform sampler2D scene; uniform float threshold;
void main() { fragment = vec4(clamp((texture(scene, uv).rgb - threshold) / (1.0 - threshold), 0.0, 1.0), 1.0); }`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 fragment;
uniform sampler2D image; uniform vec2 step; uniform float deviation; uniform int taps;
void main() {
  vec3 sum = texture(image, uv).rgb; float weights = 1.0;
  for (int i = 1; i <= 16; i++) {
    if (i > taps / 2) break;
    float w = exp(-float(i * i) / (2.0 * deviation * deviation));
    sum += (texture(image, uv + step * float(i)).rgb + texture(image, uv - step * float(i)).rgb) * w; weights += 2.0 * w;
  }
  fragment = vec4(sum / weights, 1.0);
}`;

const COMPOSE_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 fragment;
uniform sampler2D scene; uniform sampler2D occlusion; uniform sampler2D bloom;
uniform bool occluded, bloomed; uniform vec4 bloomTerms;
vec3 saturation(vec3 c, float amount) { return mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, amount); }
void main() {
  vec3 base = texture(scene, uv).rgb;
  if (occluded) base *= texture(occlusion, uv).r;
  if (bloomed) {
    vec3 glow = saturation(texture(bloom, uv).rgb, bloomTerms.y) * bloomTerms.x;
    base = saturation(base, bloomTerms.w) * bloomTerms.z;
    base = base * (1.0 - clamp(glow, 0.0, 1.0)) + glow;
  }
  fragment = vec4(base, 1.0);
}`;

export interface PostSettings { readonly occlusion?: { radius: number; strength: number; power: number; clampTo: number; horizon: number; fadeFrom: number; fadeTo: number; passes: number }; readonly bloom?: { threshold: number; intensity: number; saturation: number; baseIntensity: number; baseSaturation: number; blur: number; taps: number } }

export function postSettings(config: PostProcessing): PostSettings {
  const ao = config.ASSAO ?? {}, bloom = config.Bloom ?? {};
  return {
    ...((ao.Enabled ?? 1) > 0 ? { occlusion: { radius: ao.Radius ?? 40, strength: ao.ShadowMultiplier ?? 1.2, power: ao.ShadowPower ?? 5, clampTo: ao.ShadowClamp ?? 1, horizon: ao.HorizonAngleThreshold ?? 0.5, fadeFrom: ao.FadeOutFrom ?? 1300, fadeTo: ao.FadeOutTo ?? 0, passes: ao.BlurPassCount ?? 2 } } : {}),
    ...((bloom.Enabled ?? 0) > 0 ? { bloom: { threshold: bloom.BloomThreshold ?? 0.72, intensity: bloom.BloomIntensity ?? 0.9, saturation: bloom.BloomSaturation ?? 1, baseIntensity: bloom.BaseIntensity ?? 1, baseSaturation: bloom.BaseSaturation ?? 1, blur: bloom.BlurAmount ?? 3.75, taps: bloom.BlurSampleCount ?? 12 } } : {}),
  };
}

interface Image { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number }
function image(gl: WebGL2RenderingContext, width: number, height: number): Image {
  const texture = colorTexture(gl, width, height), framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, width, height };
}

export function postProcessor(gl: WebGL2RenderingContext, target: SceneTarget) {
  const vao = gl.createVertexArray(), buffer = gl.createBuffer();
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const passes = { ao: pass(gl, AO_FS), aoBlur: pass(gl, AO_BLUR_FS), bright: pass(gl, BRIGHT_FS), blur: pass(gl, BLUR_FS), compose: pass(gl, COMPOSE_FS) };
  const full = [image(gl, target.width, target.height), image(gl, target.width, target.height)] as const;
  const halfWidth = Math.max(1, target.width >> 1), halfHeight = Math.max(1, target.height >> 1);
  const half = [image(gl, halfWidth, halfHeight), image(gl, halfWidth, halfHeight)] as const;
  const draw = (into: Image | null, used: Pass, textures: readonly (readonly [string, WebGLTexture])[], uniforms: (at: Pass["uniform"]) => void) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, into?.framebuffer ?? null);
    gl.viewport(0, 0, into?.width ?? target.width, into?.height ?? target.height);
    gl.useProgram(used.program);
    textures.forEach(([name, texture], unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(used.uniform(name), unit); });
    uniforms(used.uniform);
    gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
  };
  return (settings: PostSettings, inverseProjection: Matrix, focal: readonly [number, number]) => {
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    const texel = [1 / target.width, 1 / target.height] as const;
    let occlusion: Image | undefined;
    if (settings.occlusion !== undefined) {
      const ao = settings.occlusion, span = ao.fadeTo - ao.fadeFrom;

      const fadeMul = span === 0 ? 0 : -1 / span, fadeAdd = span === 0 ? 1 : ao.fadeFrom / span + 1;
      draw(full[0], passes.ao, [["depthMap", target.depth]], (at) => {
        gl.uniformMatrix4fv(at("inverseProjection"), false, inverseProjection); gl.uniform2f(at("texel"), ...texel); gl.uniform2f(at("focal"), focal[0], focal[1]);

        gl.uniform1f(at("radius"), ao.radius);
        gl.uniform1f(at("strength"), ao.strength * 4.3 / 15); gl.uniform1f(at("power"), ao.power); gl.uniform1f(at("clampTo"), ao.clampTo);
        gl.uniform1f(at("horizon"), Math.min(ao.horizon, 0.99)); gl.uniform1f(at("fadeMul"), fadeMul); gl.uniform1f(at("fadeAdd"), fadeAdd);
      });
      occlusion = full[0];
      for (let index = 0; index < ao.passes; index++) {
        const from: Image = occlusion, into: Image = from === full[0] ? full[1] : full[0];
        draw(into, passes.aoBlur, [["occlusion", from.texture], ["depthMap", target.depth]], (at) => gl.uniform2f(at("texel"), ...texel));
        occlusion = into;
      }
    }
    let glow: Image | undefined;
    if (settings.bloom !== undefined) {
      const bloom = settings.bloom;
      draw(half[0], passes.bright, [["scene", target.color]], (at) => gl.uniform1f(at("threshold"), Math.min(bloom.threshold, 0.999)));

      const scale = target.height / 1080;
      draw(half[1], passes.blur, [["image", half[0].texture]], (at) => { gl.uniform2f(at("step"), scale / halfWidth, 0); gl.uniform1f(at("deviation"), bloom.blur); gl.uniform1i(at("taps"), bloom.taps); });
      draw(half[0], passes.blur, [["image", half[1].texture]], (at) => { gl.uniform2f(at("step"), 0, scale / halfHeight); gl.uniform1f(at("deviation"), bloom.blur); gl.uniform1i(at("taps"), bloom.taps); });
      glow = half[0];
    }
    draw(null, passes.compose, [["scene", target.color], ["occlusion", occlusion?.texture ?? target.color], ["bloom", glow?.texture ?? target.color]], (at) => {
      gl.uniform1i(at("occluded"), occlusion === undefined ? 0 : 1); gl.uniform1i(at("bloomed"), glow === undefined ? 0 : 1);
      const b = settings.bloom;
      gl.uniform4f(at("bloomTerms"), b?.intensity ?? 0, b?.saturation ?? 1, b?.baseIntensity ?? 1, b?.baseSaturation ?? 1);
    });
    for (let unit = 0; unit < 3; unit++) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  };
}

export function invert(m: Matrix): Matrix {
  const out = new Float32Array(16), a = Array.from(m);
  const [a00 = 0, a01 = 0, a02 = 0, a03 = 0, a10 = 0, a11 = 0, a12 = 0, a13 = 0, a20 = 0, a21 = 0, a22 = 0, a23 = 0, a30 = 0, a31 = 0, a32 = 0, a33 = 0] = a;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  out.set([
    (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ]);
  return out;
}
export { dot };
