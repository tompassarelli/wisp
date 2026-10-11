import { test, expect } from "bun:test";
import { deflateSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect } from "effect";
import { checkFidelity, measureImages } from "../scripts/wisp/fidelity/check";
import { deltaE00 } from "../scripts/wisp/fidelity/colour";
import { colourMetric } from "../scripts/wisp/fidelity/metric";
import type { CaptureManifest } from "../scripts/wisp/fidelity/manifest";

const region = { id:"body",x:0,y:0,width:9,height:9,critical:true };
const image = (value: number) => ({width:9,height:9,rgb:new Uint8Array(9*9*3).fill(value)});
const source = "wisp#75 P4.1 and P5–P7 hard gate bounds";
function fixture(): CaptureManifest {
  const controls = [
    {id:"stock",mode:"stock" as const,fog:false,bloom:false,dof:0,cine:false},
    {id:"mask",mode:"mask" as const,fog:true,bloom:true,dof:12,cine:true},
    {id:"stage",mode:"stage" as const,fog:false,bloom:false,dof:25,cine:true},
  ];
  return {version:1,split:{frozenAt:"2026-10-10T00:00:00Z",fit:["fit-scene"],heldOut:["held-scene"],retired:[]},slices:[{
    lever:"water",scene:"held-scene",kind:"lever",split:"held-out",pad:"synthetic.pad",frames:[227],
    camera:{position:[0,0,10],target:[0,0,0],fov:45},look:"definitive",
    identity:{build:"synthetic",assetLayers:["synthetic"],mapHash:"synthetic",settingsFile:"synthetic",resolution:{width:9,height:9},gpu:"synthetic"},
    settings:{density:1},calibratedRanges:{density:{min:0,max:2}},regions:[region],controls,cineWindow:{start:227,end:227},
    runs:[0,1,2].map(run=>({id:String(run),captures:controls.map(control=>({frame:227,frameSource:"journal" as const,control:control.id,image:`${run}-${control.id}.png`}))})),
  }]};
}
function png(value: number): Uint8Array { return pngOf({width:9,height:9,rgb:new Uint8Array(9*9*3).fill(value)}); }
function pngOf(picture: {width:number;height:number;rgb:Uint8Array}): Uint8Array {
  const {width,height}=picture;
  const crc = (bytes: Uint8Array) => { let v=0xffffffff; for (const b of bytes) { v ^= b; for(let i=0;i<8;i++) v=(v>>>1)^((v&1) ? 0xedb88320 : 0); } return (v^0xffffffff)>>>0; };
  const chunk = (name: string, bytes: Uint8Array) => {
    const body=Buffer.concat([Buffer.from(name),bytes]), length=Buffer.alloc(4), sum=Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);sum.writeUInt32BE(crc(body));return Buffer.concat([length,body,sum]);
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const raw=Buffer.alloc(height*(width*3+1));for(let y=0;y<height;y++)raw.set(picture.rgb.subarray(y*width*3,(y+1)*width*3),y*(width*3+1)+1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(raw)),chunk("IEND",new Uint8Array())]);
}
test(`${source}: synthetic PNG capture boundary returns PASS, FAIL, INCONCLUSIVE, and refuses identities, fit scenes, calibration and undecided levers before pixels`, async () => {
  const directory=mkdtempSync(join(tmpdir(),"wisp-fidelity-"));
  try {
    const write = async (dir: string, values: readonly number[]) => {
      const manifest=fixture();await Bun.write(join(dir,"manifest.json"),JSON.stringify(manifest));
      for(const slice of manifest.slices)for(const [i,run]of slice.runs.entries())for(const capture of run.captures)await Bun.write(join(dir,capture.image),png(values[i] ?? 0));
    };
    const ref=join(directory,"reference"),cand=join(directory,"candidate");
    await write(ref,[100,100,100]);await write(cand,[101,101,101]);
    const check=()=>Effect.runPromise(checkFidelity("water",ref,cand).pipe(Effect.provide(BunServices.layer)));
    expect((await check()).verdict).toBe("PASS");
    await write(cand,[220,220,220]);expect((await check()).verdict).toBe("FAIL");
    await write(ref,[100,150,100]);expect((await check()).verdict).toBe("INCONCLUSIVE");
    const candidate=fixture();candidate.slices[0]!.identity.build="different";
    await Bun.write(join(cand,"manifest.json"),JSON.stringify(candidate));
    await expect(check()).rejects.toThrow("identity mismatch");
    const refuse = async (edit: (manifest: CaptureManifest) => void, lever: string, problem: string) => {
      for (const dir of [ref,cand]) { const manifest=fixture();edit(manifest);await Bun.write(join(dir,"manifest.json"),JSON.stringify(manifest)); }
      await expect(Effect.runPromise(checkFidelity(lever,ref,cand).pipe(Effect.provide(BunServices.layer)))).rejects.toThrow(problem);
    };
    await refuse(manifest=>{manifest.slices[0]!.settings.density=3;},"water","outside calibrated range");
    await refuse(manifest=>{manifest.slices[0]!.scene="fit-scene";manifest.slices[0]!.split="fit";},"water","fit-set");
    await refuse(manifest=>{manifest.slices[0]!.lever="terrain";},"terrain","no decided fidelity bound");
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
test("wisp#75 G5a: draw-extent silhouettes from shown/hidden PNG pairs return PASS at 3 px, FAIL at 5 px, and INCONCLUSIVE for a 3 px reference run spread or an empty reference silhouette", async () => {
  const directory=mkdtempSync(join(tmpdir(),"wisp-draw-extent-"));
  try {
    const size=24, controls=[{id:"shown",visibility:"shown" as const},{id:"hidden",visibility:"hidden" as const}];
    const manifest=fixture(), slice=manifest.slices[0]!;
    Object.assign(slice,{lever:"draw-extent",controls,regions:[{id:"fighter",x:0,y:0,width:size,height:size,critical:true}],identity:{...slice.identity,resolution:{width:size,height:size}},
      runs:[0,1,2].map(run=>({id:String(run),captures:controls.map(control=>({frame:227,frameSource:"debugger" as const,control:control.id,image:`${run}-${control.id}.png`}))}))});
    delete (slice as {cineWindow?:unknown}).cineWindow;
    // Hidden is a flat backdrop; shown adds an 8x8 fighter at column `left` (undefined: nothing drawn).
    const picture=(left?: number)=>{
      const rgb=new Uint8Array(size*size*3).fill(50);
      if (left!==undefined) for(let y=8;y<16;y++)for(let x=left;x<left+8;x++)rgb.set([60,200,40],(y*size+x)*3);
      return {width:size,height:size,rgb};
    };
    const write=async(dir: string, lefts: readonly (number|undefined)[])=>{
      await Bun.write(join(dir,"manifest.json"),JSON.stringify(manifest));
      for(const [i,run]of slice.runs.entries()){await Bun.write(join(dir,`${run.id}-shown.png`),pngOf(picture(lefts[i])));await Bun.write(join(dir,`${run.id}-hidden.png`),pngOf(picture()));}
    };
    const ref=join(directory,"reference"),cand=join(directory,"candidate");
    const check=()=>Effect.runPromise(checkFidelity("draw-extent",ref,cand).pipe(Effect.provide(BunServices.layer)));
    await write(ref,[8,8,8]);await write(cand,[11,11,11]);
    const pass=await check();
    expect(pass.measurements.map(m=>[m.control,m.metric,m.bound,m.spread,m.error,m.verdict])).toEqual([["shown","draw-extent",4,0,3,"PASS"]]);
    expect(pass.verdict).toBe("PASS");
    await write(cand,[13,13,13]);expect((await check()).verdict).toBe("FAIL");
    await write(ref,[8,11,8]);await write(cand,[8,8,8]);
    const unstable=await check();
    expect([unstable.verdict,unstable.measurements[0]?.spread,unstable.measurements[0]?.bound]).toEqual(["INCONCLUSIVE",3,4]);
    await write(ref,[undefined,undefined,undefined]);expect((await check()).verdict).toBe("INCONCLUSIVE");
    slice.controls=[controls[0]!,{id:"hidden",visibility:"shown"}];await write(ref,[8,8,8]);
    await expect(check()).rejects.toThrow("needs exactly one hidden visibility control");
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
test(`${source}: strict half-bound spread and full-bound comparison`, () => {
  const scalar={name:"synthetic-luma",bound:4,distance:(a:ReturnType<typeof image>,b:ReturnType<typeof image>)=>Math.abs((a.rgb[0] ?? 0)-(b.rgb[0] ?? 0))};
  expect(measureImages(scalar,[image(0),image(2),image(0)],[image(4)],region).verdict).toBe("PASS");
  expect(measureImages(scalar,[image(0),image(3),image(0)],[image(4)],region).verdict).toBe("INCONCLUSIVE");
  expect(measureImages(scalar,[image(0),image(0),image(0)],[image(5)],region).verdict).toBe("FAIL");
});
test("CIEDE2000 published Sharma supplementary pair 1 and identity", () => {
  expect(deltaE00([50,2.6772,-79.7751],[50,0,-82.7485])).toBeCloseTo(2.0425,4);
  expect(colourMetric.distance(image(100),image(100),region)).toBe(0);
});
