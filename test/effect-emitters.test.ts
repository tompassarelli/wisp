import { expect, test } from "bun:test";
import { ModelRenderer, parseMDL } from "../vendor/war3-model.mjs";
import { animationSample } from "../src/headless/animation";
import { advanceEmitters, type EmitterRenderer } from "../scripts/wisp/browser/emitters";

const emitter = (name: string, id: number, rate: string, squirt: boolean) => `ParticleEmitter2 "${name}" {
  ObjectId ${id},
  static Speed 100,
  static Variation 0,
  static Latitude 0,
  static Gravity 0,
  ${rate},
  static Width 0,
  static Length 0,
  Additive,
  Rows 1,
  Columns 1,
  Head,
  TailLength 0,
  Time 0.5,
  SegmentColor { Color { 1, 1, 1 }, Color { 1, 1, 1 }, Color { 1, 1, 1 }, },
  Alpha { 255, 255, 0 },
  ParticleScaling { 10, 20, 30 },
  LifeSpanUVAnim { 0, 0, 1 },
  DecayUVAnim { 0, 0, 1 },
  TailUVAnim { 0, 0, 1 },
  TailDecayUVAnim { 0, 0, 1 },
  TextureID 0,
  ${squirt ? "Squirt," : ""}
  LifeSpan 1,
}`;


const nova = parseMDL(`Version { FormatVersion 800, }
Model "Nova" { NumGeosets 0, BlendTime 150, }
Sequences 1 { Anim "Birth" { Interval { 0, 1500 }, NonLooping, } }
Textures 1 { Bitmap { Image "Textures\\\\Frost2.blp", } }
${emitter("Ring", 0, "EmissionRate 3 { DontInterp, 0: 0, 33: 50, 167: 0, }", true)}
${emitter("Fifty", 1, "static EmissionRate 50", false)}
${emitter("Sixty", 2, "static EmissionRate 60", false)}
PivotPoints 3 { { 0, 0, 0 }, { 0, 0, 0 }, { 0, 0, 0 }, }`);
const sequences = nova.Sequences.map((sequence) => ({ name: sequence.Name, start: sequence.Interval[0] ?? 0, end: sequence.Interval[1] ?? 0, looping: !sequence.NonLooping, rarity: sequence.Rarity }));


function particlesAt(ms: number): Record<string, number> {
  const renderer = new ModelRenderer(nova);
  renderer.setSequence(0);
  const animation = { subAnimations: [], elapsed: ms / 1000 };
  const stepped = renderer as unknown as EmitterRenderer & { particlesController: { emitters: { props: { Name: string }; particles: unknown[] }[] } };
  advanceEmitters(stepped, nova.Sequences, sequences, animation, "effect", 0, ms);
  stepped.rendererData.frame = animationSample(sequences, animation, "effect").frame;
  renderer.update(0);
  return Object.fromEntries(stepped.particlesController.emitters.map((e) => [e.props.Name, e.particles.length]));
}

test("[native #40] emitters run one frame behind: two frames in, no squirt ring and no 50/s particle, one 60/s particle", () => {

  expect(particlesAt(1000 / 30)).toEqual({ Ring: 0, Fifty: 0, Sixty: 1 });
  expect(particlesAt(60)).toEqual({ Ring: 50, Fifty: 2, Sixty: 2 });
});
