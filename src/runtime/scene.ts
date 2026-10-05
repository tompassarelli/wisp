// Names and line formats of the scene report, shared by the map's recorder
// (src/platform/scene.ts) and the host's check (scripts/wisp/scene.ts).
// The game only writes this file and nothing in the game reads it back, so
// one name per slot is safe under the Preloader rule in gameFiles.ts.

/** A client's scene report, rewritten while the map runs. */
export const sceneFile = (slot: number, prefix = "wisp") => `${prefix}-scene-p${slot}.txt`;

/** The report's first line: its serial, the game frame it describes and how many effects exist. */
export const sceneHeading = (serial: number, frame: number, effects: number) => `scene ${serial} frame ${frame} effects ${effects}`;

/** What the report says about every effect created with one model path. */
export interface SceneModel {
  /** The model path with `/` for `\`; empty when the game named none. */
  readonly model: string;
  /** Effects of this model that exist. */
  readonly live: number;
  /** Those in view, wherever the game doesn't park hidden effects. Alpha and scale don't stop a model's particle emitters. */
  readonly inView: number;
  /** Those in view with their model drawn: alpha and scale above zero. */
  readonly drawn: number;
  /** The game frame the oldest live one was created on; undefined when none is left. */
  readonly created: number | undefined;
  /** Frames the longest-standing one in view has been there; undefined while none is. */
  readonly age: number | undefined;
  /** The longest any one of them stayed in view without a break since the report started. */
  readonly longest: number;
  /** How many were destroyed in view, where Warcraft plays their death animation, since the report started. */
  readonly destroyed: number;
}

/** Backslashes would sit inside the Preload file's JASS string literals. */
export const reportedModel = (model: string) => model.replaceAll("\\", "/");

/** One line per model, its path last because a path may contain spaces. */
export const sceneModelLine = ({ model, live, inView, drawn, created, age, longest, destroyed }: SceneModel) =>
  `model ${live} ${inView} ${drawn} ${created ?? "-"} ${age ?? "-"} ${longest} ${destroyed} ${model}`;
