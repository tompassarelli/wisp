import type { EffectPose, HeadlessClient } from "../../src/headless/client";
import type { Environment } from "../../src/headless/warcraft3Scenery";
import type { Terrain, WorldBounds } from "../terrain/terrain";
import type { TerrainDoodad } from "../terrain/doodads";

export interface RenderScene {
  readonly frame: number;
  readonly matchFrame?: number;
  readonly playing?: boolean;
  readonly client: number;
  readonly effects: readonly DrawnPose[];
  readonly units: ReturnType<HeadlessClient["unitPoses"]>;
  readonly camera: ReturnType<HeadlessClient["cameraPose"]>;
  readonly ui: ReturnType<HeadlessClient["frames"]["snapshot"]>;
  readonly environment: SceneEnvironment;

  readonly filter?: ReturnType<HeadlessClient["cineFilterPose"]>;

  readonly textTags?: ReturnType<HeadlessClient["textTags"]["poses"]>;

  readonly lightnings?: ReturnType<HeadlessClient["lightnings"]["poses"]>;

  readonly weathers?: ReturnType<HeadlessClient["weathers"]["poses"]>;

  readonly world?: WorldBounds;
  readonly terrain?: Terrain;
  readonly terrainDoodads?: { readonly placements: readonly TerrainDoodad[]; readonly models: Readonly<Record<string, string | readonly string[]>> };
}

export interface SceneEnvironment extends Environment {

  readonly fog?: SceneFog;

  readonly shadowCastingPointLights?: number;
}

interface SceneFog {

  readonly style: number;
  readonly zStart: number;
  readonly zEnd: number;
  readonly density: number;

  readonly color: readonly [number, number, number];

  readonly heightStart?: number | undefined;
  readonly heightEnd?: number | undefined;

  readonly linearStart?: number | undefined;
  readonly linearEnd?: number | undefined;
  readonly maxLinearDensity?: number | undefined;
  readonly drawOverSky?: boolean | undefined;
}

export type DrawnPose = EffectPose & { readonly unit?: true };
