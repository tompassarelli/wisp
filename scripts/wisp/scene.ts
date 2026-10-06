// Scene checks: what a player sees, read from the scene report each client's
// map writes (wisp:src/platform/scene.ts) against the game's declared
// expectations. A check fails on a missing stage, an effect created with no
// model, an effect in view that the game declares no kind for, or one in view
// longer than its kind's lifetime, and says what a player would see wrong.
// With the game's model facts and cameras it also fails on what a player
// could see that the game considers hidden or gone (visibility.ts), and,
// given what must be on screen, a fighter in play drawn with nothing.
// Plain functions, so a game's tests can check a report without Effect;
// playerView.ts reads the files.
import { type SceneModel, reportedModel } from "../../src/runtime/scene";
import type { ModelFacts } from "./models";
import { type VisibilityExpectations, visibilityProblems } from "./visibility";

export interface SceneReport {
  readonly serial: number;
  /** The game frame the report describes. */
  readonly frame: number;
  /** Effects that exist, shown or hidden. */
  readonly effects: number;
  readonly models: readonly SceneModel[];
}

const NUMBER = "(\\d+)(?:\\.0)?";
const HEADING = new RegExp(`^scene ${NUMBER} frame ${NUMBER} effects ${NUMBER}$`);
const MODEL_LINE = new RegExp(`^model ${NUMBER} ${NUMBER} ${NUMBER} (?:${NUMBER}|-) (?:${NUMBER}|-) ${NUMBER} ${NUMBER} ?(.*)$`);
const optional = (text: string | undefined) => (text === undefined ? undefined : Number(text));

export interface MalformedSceneLine {
  /** One-based, as the file's Preload lines count. */
  readonly line: number;
  readonly problem: string;
}

/** The report the recorder's Preload lines hold, or the first line that isn't one. */
export function readSceneLines(lines: readonly string[]): SceneReport | MalformedSceneLine {
  const [heading = "", ...rest] = lines;
  const head = HEADING.exec(heading);
  if (head === null || Number(head[1]) < 1) return { line: 1, problem: `expected "scene SERIAL frame FRAME effects COUNT", found "${heading}"` };
  const models: SceneModel[] = [];
  for (const [index, line] of rest.entries()) {
    const fields = MODEL_LINE.exec(line);
    if (fields === null) return { line: index + 2, problem: `expected "model LIVE IN_VIEW DRAWN CREATED AGE LONGEST DESTROYED PATH", found "${line}"` };
    models.push({
      live: Number(fields[1]),
      inView: Number(fields[2]),
      drawn: Number(fields[3]),
      created: optional(fields[4]),
      age: optional(fields[5]),
      longest: Number(fields[6]),
      destroyed: Number(fields[7]),
      model: fields[8] ?? "",
    });
  }
  return { serial: Number(head[1]), frame: Number(head[2]), effects: Number(head[3]), models };
}

/** A kind of effect the game draws. */
export interface SceneKind {
  /** What a player would call it, such as "stage deck" or "hit spark". */
  readonly name: string;
  /** Every model path the game creates it with, as the game names them. */
  readonly models: readonly string[];
  /** The most frames one may stay in view without a break; absent for what may stay all match, such as the stage. */
  readonly lifetime?: number;
}

export interface SceneExpectations {
  readonly kinds: readonly SceneKind[];
  /** The kind the stage is drawn with, and how many of its pieces must be drawn. */
  readonly stage: { readonly kind: string; readonly pieces: number };
  /** The game's frames per second, to say lifetimes in seconds. */
  readonly framesPerSecond: number;
  /** What the game's models draw and where its cameras look, to find what a player sees of hidden effects. */
  readonly visibility?: VisibilityExpectations;
}

export interface SceneProblem {
  /** What a player sees wrong. */
  readonly seen: string;
  /** What in the report shows it. */
  readonly evidence: string;
}

const names = (kinds: readonly SceneKind[]) => [...new Set(kinds.map(({ name }) => name))].join(", ");

/** Everything a player would see wrong in this report. */
export function sceneProblems(report: SceneReport, expected: SceneExpectations): readonly SceneProblem[] {
  const declared = new Map<string, SceneKind[]>();
  for (const kind of expected.kinds) {
    for (const model of kind.models) declared.set(reportedModel(model), [...(declared.get(reportedModel(model)) ?? []), kind]);
  }
  const seconds = (frames: number) => (frames / expected.framesPerSecond).toFixed(2);
  const problems: SceneProblem[] = [];
  const stageModels = stageModelsOf(expected);
  const pieces = stagePieces(report, stageModels);
  if (pieces < expected.stage.pieces) {
    problems.push({
      seen: `no stage under the fighters: ${pieces} of the ${expected.stage.pieces} ${expected.stage.kind} pieces a match needs are drawn`,
      evidence: stageModels.size === 0 ? `the game declares no ${expected.stage.kind} model` : `models ${[...stageModels].join(", ")}`,
    });
  }
  for (const line of report.models) {
    const kinds = declared.get(line.model) ?? [];
    if (line.model === "") {
      if (line.live === 0) continue;
      problems.push({
        seen: `invisible ${kinds.length > 0 ? names(kinds) : "effects"}: ${line.live} effects were created with no model, ${line.drawn} of them meant to be drawn now`,
        evidence: "model path is empty",
      });
      continue;
    }
    if (kinds.length === 0) {
      if (line.inView > 0) {
        problems.push({
          seen: `${line.inView} effect${line.inView === 1 ? "" : "s"} in view that the game declares no kind for, the oldest for ${seconds(line.age ?? 0)} s`,
          evidence: `model ${line.model}, ${line.drawn} drawn`,
        });
      }
      continue;
    }
    // Kinds sharing a model share their longest lifetime; one without a lifetime may stay all match.
    const lifetime = kinds.some(({ lifetime }) => lifetime === undefined) ? undefined : Math.max(...kinds.map(({ lifetime }) => lifetime ?? 0));
    if (lifetime !== undefined && line.longest > lifetime) {
      problems.push({
        seen: `a ${names(kinds)} stayed in view for ${seconds(line.longest)} s; it should be gone within ${seconds(lifetime)} s`,
        evidence: `model ${line.model}: ${line.longest} frames without a break, lifetime ${lifetime}; now ${line.inView} of ${line.live} in view, ${line.drawn} drawn`,
      });
    }
  }
  if (expected.visibility !== undefined) problems.push(...visibilityProblems(report, expected.kinds, expected.visibility));
  return problems;
}

const stageModelsOf = (expected: SceneExpectations) =>
  new Set((expected.kinds.find(({ name }) => name === expected.stage.kind)?.models ?? []).map(reportedModel).filter((model) => model !== ""));

/** Stage pieces drawn in view; a piece with no model draws nothing. */
const stagePieces = (report: SceneReport, models: ReadonlySet<string>) =>
  report.models.filter(({ model }) => models.has(model)).reduce((sum, { drawn }) => sum + drawn, 0);

/** One line on what the report shows, for a passing check's log. */
export function describeScene(report: SceneReport, expected: SceneExpectations): string {
  const pieces = stagePieces(report, stageModelsOf(expected));
  const inView = report.models.reduce((sum, { inView }) => sum + inView, 0);
  return `frame ${report.frame}: ${pieces} ${expected.stage.kind} piece${pieces === 1 ? "" : "s"} drawn; ${inView} of ${report.effects} effects in view across ${report.models.length} models`;
}

/** Something a player must see now, such as a fighter in play, and every model the game may draw it with. */
export interface SceneBody {
  /** What a player would call it, such as "Illidan (Player 2)". */
  readonly name: string;
  readonly models: readonly string[];
}

/**
 * Each body the report shows nothing of: no effect of its models is drawn
 * with geometry. A model counts as geometry when its facts have triangles,
 * or when it has no facts to judge it by. Bodies drawn with the same models
 * share their effects, so two of one fighter need two drawn.
 */
export function bodyProblems(report: SceneReport, bodies: readonly SceneBody[], facts: Readonly<Record<string, ModelFacts>> = {}): readonly SceneProblem[] {
  const triangles = new Map(Object.entries(facts).map(([model, entry]) => [reportedModel(model).toLowerCase(), entry.triangles]));
  const groups = new Map<string, { readonly models: ReadonlySet<string>; readonly names: string[] }>();
  for (const { name, models } of bodies) {
    const paths = [...new Set(models.map((model) => reportedModel(model).toLowerCase()))].sort();
    const group = groups.get(paths.join("|")) ?? { models: new Set(paths), names: [] };
    group.names.push(name);
    groups.set(paths.join("|"), group);
  }
  const problems: SceneProblem[] = [];
  for (const { models, names } of groups.values()) {
    const lines = report.models.filter(({ model }) => models.has(model.toLowerCase()));
    const solid = lines.filter(({ model }) => (triangles.get(model.toLowerCase()) ?? 1) > 0);
    const drawn = solid.reduce((sum, { drawn }) => sum + drawn, 0);
    if (drawn >= names.length) continue;
    const empty = lines.filter(({ model, drawn }) => drawn > 0 && triangles.get(model.toLowerCase()) === 0);
    problems.push({
      seen: names.length === 1
        ? `invisible fighter: ${names.join("")} is in play, but none of its models is drawn with geometry`
        : `invisible fighter: ${names.join(" and ")} are in play, but ${drawn === 0 ? "none" : `only ${drawn}`} of them ${drawn <= 1 ? "is" : "are"} drawn with geometry`,
      evidence: empty.length > 0
        ? `drawn without triangles: ${empty.map(({ model, drawn }) => `${model} (${drawn})`).join(", ")}`
        : `${lines.reduce((sum, { live }) => sum + live, 0)} effects of its ${models.size} models live, ${lines.reduce((sum, { inView }) => sum + inView, 0)} in view, none drawn`,
    });
  }
  return problems;
}
