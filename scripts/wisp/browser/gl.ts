/** Compiles and links one WebGL program; attributes bind to locations 0, 1, ... in order. */
export function linkProgram(gl: WebGL2RenderingContext, label: string, vertex: string, fragment: string, attributes: readonly string[] = []): WebGLProgram {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (shader === null) throw new Error(`cannot create ${label} shader`);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`${label} shader: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  };
  const program = gl.createProgram();
  if (program === null) throw new Error(`cannot create ${label} program`);
  const shaders = [compile(gl.VERTEX_SHADER, vertex), compile(gl.FRAGMENT_SHADER, fragment)];
  for (const shader of shaders) gl.attachShader(program, shader);
  attributes.forEach((name, location) => gl.bindAttribLocation(program, location, name));
  gl.linkProgram(program);
  for (const shader of shaders) gl.deleteShader(shader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`${label} program: ${gl.getProgramInfoLog(program)}`);
  return program;
}
