import { generateMDX, ModelRenderer, parseMDL } from "../../vendor/war3-model.mjs";

const fixtures = `${import.meta.dir}/../../window/wisp-window/tests/fixtures`;
const CASES = [
  { sequence: 0, frame: 0, global: 0 },
  { sequence: 0, frame: 250, global: 100 },
  { sequence: 0, frame: 500, global: 200 },
  { sequence: 0, frame: 750, global: 300 },
  { sequence: 0, frame: 1000, global: 400 },
  { sequence: 1, frame: 1000, global: 0 },
  { sequence: 1, frame: 1250, global: 150 },
  { sequence: 1, frame: 1500, global: 250 },
  { sequence: 1, frame: 1800, global: 350 },
  { sequence: 1, frame: 2000, global: 50 },
] as const;

const mdl = await Bun.file(`${fixtures}/rig.mdl`).text();
const data = parseMDL(mdl);
await Bun.write(`${fixtures}/rig.mdx`, generateMDX(data));
await Bun.write(`${fixtures}/water-flipbook.mdx`, generateMDX(parseMDL(await Bun.file(`${fixtures}/water-flipbook.mdl`).text())));

const renderer = new ModelRenderer(data) as unknown as {
  rendererData: { frame: number; animation: number; animationInfo: unknown; globalSequencesFrames: number[]; nodes: { matrix: Float32Array }[] };
  updateNode(node: unknown): void;
  generateGeosetVertices(index: number): void;
  vertices: Float32Array[];
  vertexBuffer: unknown[];
  gl: unknown;
};
renderer.gl = { ARRAY_BUFFER: 0, DYNAMIC_DRAW: 0, bindBuffer() {}, bufferData() {} };
renderer.vertices = data.Geosets.map((geoset) => new Float32Array(geoset.Vertices.length));
renderer.vertexBuffer = data.Geosets.map(() => null);

const expected = CASES.map(({ sequence, frame, global }) => {
  const state = renderer.rendererData;
  state.animation = sequence;
  state.animationInfo = data.Sequences[sequence];
  state.frame = frame;
  state.globalSequencesFrames[0] = global;
  renderer.updateNode((state as unknown as { rootNode: unknown }).rootNode);
  const geosets = data.Geosets.map((_, index) => { renderer.generateGeosetVertices(index); return Array.from(renderer.vertices[index] ?? []); });
  const nodes = state.nodes.map((node) => (node === undefined ? null : Array.from(node.matrix)));
  return { sequence, frame, global, nodes, geosets };
});
await Bun.write(`${fixtures}/rig.expected.json`, `${JSON.stringify(expected)}\n`);
