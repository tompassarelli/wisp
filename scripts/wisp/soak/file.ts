import { Schema } from "effect";
import { SOAK_GAME, SOAK_PROJECT, type SoakFinding, type SoakGame, type SoakProject, type SoakResult } from "./soak";
import type { SoakInputs, SoakMatch } from "./types";

export interface SoakRepro {
  readonly format: "wisp-soak-repro";
  readonly version: 1;

  readonly project: string;
  readonly match: SoakMatch;
  readonly findings: readonly SoakFinding[];
  readonly checksums: readonly string[];
  readonly inputs: SoakInputs;
}

export const soakRepro = (project: string, result: SoakResult): SoakRepro => ({
  format: "wisp-soak-repro",
  version: 1,
  project,
  match: result.match,
  findings: result.findings,
  checksums: result.checksums,
  inputs: result.inputs,
});

const Whole = Schema.Int;
const MatchSchema = Schema.Struct({
  index: Whole, seed: Whole, fighters: Schema.Array(Schema.String), stage: Schema.String, policies: Schema.Array(Schema.String), frames: Whole,
  typed: Schema.optionalKey(Schema.Boolean),
});
const FindingSchema = Schema.Struct({
  kind: Schema.Literals(["stall", "desync", "error", "scene", "invisible", "cost", "typing", "catch-up", "unfinished", "crash", "game"]),
  frame: Whole,
  slot: Schema.optionalKey(Whole),
  text: Schema.String,
});
const InputsSchema = Schema.Struct({
  edges: Schema.Array(Schema.Tuple([Whole, Whole, Schema.Union([
    Schema.Struct({ button: Whole, down: Schema.Boolean }),
    Schema.Struct({ axis: Whole, value: Whole }),
  ])])),
  silences: Schema.Array(Schema.Tuple([Whole, Whole, Whole])),
  hitches: Schema.Array(Schema.Tuple([Whole, Whole])),
  slow: Schema.Array(Schema.Tuple([Whole, Schema.Finite])),
  typed: Schema.optionalKey(Schema.Array(Schema.Tuple([Whole, Whole, Schema.String]))),
  files: Schema.optionalKey(Schema.Array(Schema.Tuple([Whole, Whole, Schema.String, Schema.Array(Schema.String)]))),
});
const ReproFile = Schema.fromJsonString(Schema.Struct({
  format: Schema.Literal("wisp-soak-repro"),
  version: Schema.Literal(1),
  project: Schema.String,
  match: MatchSchema,
  findings: Schema.Array(FindingSchema),
  checksums: Schema.Array(Schema.String),
  inputs: InputsSchema,
}));

export const readSoakRepro = (text: string): SoakRepro => Schema.decodeSync(ReproFile)(text);

export const readSoakMatch = (line: string): SoakMatch => Schema.decodeSync(Schema.fromJsonString(MatchSchema))(line);

export interface SoakReply extends Omit<SoakResult, "inputs"> {
  readonly inputs?: SoakInputs;
  readonly workerCpuMs?: number;
}

const ReplySchema = Schema.fromJsonString(Schema.Struct({
  match: MatchSchema,
  frames: Whole,
  wallMs: Schema.Finite,
  costMs: Schema.Finite,
  worstFrameMs: Schema.Finite,
  typingStallsMs: Schema.Array(Schema.Finite),
  over: Schema.Boolean,
  findings: Schema.Array(FindingSchema),
  checksums: Schema.Array(Schema.String),
  inputs: Schema.optionalKey(InputsSchema),
  workerCpuMs: Schema.optionalKey(Schema.Finite),
  repros: Schema.optionalKey(Schema.Array(Schema.Tuple([Whole, Schema.Array(Schema.String)]))),
}));

export const soakReply = ({ inputs, ...result }: SoakResult, workerCpuMs: number): SoakReply => (result.findings.length > 0 ? { ...result, inputs, workerCpuMs } : { ...result, workerCpuMs });
export const readSoakReply = (line: string): SoakReply => Schema.decodeSync(ReplySchema)(line);

const isSoakProject = (value: unknown): value is SoakProject => typeof value === "object" && value !== null && SOAK_PROJECT in value;
const isSoakGame = (value: unknown): value is SoakGame => typeof value === "object" && value !== null && SOAK_GAME in value;

async function defaultExport(path: string): Promise<unknown> {
  const module: unknown = await import(path);
  return typeof module === "object" && module !== null && "default" in module ? module.default : undefined;
}

export async function loadSoakProject(path: string): Promise<SoakProject> {
  const value = await defaultExport(path);
  if (!isSoakProject(value)) throw new Error(`${path} exports no defineSoak() declaration as its default`);
  return value;
}

export async function loadSoakGame(path: string): Promise<SoakGame> {
  const value = await defaultExport(path);
  if (!isSoakGame(value)) throw new Error(`${path} exports no defineSoakGame() setup as its default`);
  return value;
}
