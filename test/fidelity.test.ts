import { test, expect } from "bun:test";
import { deflateSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect } from "effect";
import { checkFidelity, measureImages, validateComparison, metricsFor } from "../scripts/wisp/fidelity/check";
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
function png(value: number): Uint8Array {
  const crc = (bytes: Uint8Array) => { let v=0xffffffff; for (const b of bytes) { v ^= b; for(let i=0;i<8;i++) v=(v>>>1)^((v&1) ? 0xedb88320 : 0); } return (v^0xffffffff)>>>0; };
  const chunk = (name: string, bytes: Uint8Array) => {
    const body=Buffer.concat([Buffer.from(name),bytes]), length=Buffer.alloc(4), sum=Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);sum.writeUInt32BE(crc(body));return Buffer.concat([length,body,sum]);
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(9);header.writeUInt32BE(9,4);header[8]=8;header[9]=2;
  const raw=Buffer.alloc(9*(9*3+1),value);for(let y=0;y<9;y++)raw[y*28]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(raw)),chunk("IEND",new Uint8Array())]);
}
test(`${source}: synthetic PNG capture boundary returns PASS, FAIL, INCONCLUSIVE`, async () => {
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
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
test(`${source}: strict half-bound spread and full-bound comparison`, () => {
  const scalar={name:"synthetic-luma",bound:4,distance:(a:ReturnType<typeof image>,b:ReturnType<typeof image>)=>Math.abs((a.rgb[0] ?? 0)-(b.rgb[0] ?? 0))};
  expect(measureImages(scalar,[image(0),image(2),image(0)],[image(4)],region).verdict).toBe("PASS");
  expect(measureImages(scalar,[image(0),image(3),image(0)],[image(4)],region).verdict).toBe("INCONCLUSIVE");
  expect(measureImages(scalar,[image(0),image(0),image(0)],[image(5)],region).verdict).toBe("FAIL");
});
test(`${source}: fit scenes, identities, and calibration are refused before pixels`, () => {
  const ref=fixture(), cand=fixture();
  cand.slices[0]!.settings.density=3;ref.slices[0]!.settings.density=3;
  expect(()=>validateComparison(ref,cand,"water")).toThrow("outside calibrated range");
  const fit=fixture();fit.slices[0]!.scene="fit-scene";fit.slices[0]!.split="fit";
  expect(()=>validateComparison(fit,fit,"water")).toThrow("fit-set");
  expect(()=>metricsFor("terrain",{})).toThrow("no decided fidelity bound");
});
test("CIEDE2000 published Sharma supplementary pair 1 and identity", () => {
  expect(deltaE00([50,2.6772,-79.7751],[50,0,-82.7485])).toBeCloseTo(2.0425,4);
  expect(colourMetric.distance(image(100),image(100),region)).toBe(0);
});
