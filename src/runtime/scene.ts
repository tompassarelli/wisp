





export const sceneFile = (slot: number, prefix = "wisp") => `${prefix}-scene-p${slot}.txt`;


export const sceneHeading = (serial: number, frame: number, effects: number) => `scene ${serial} frame ${frame} effects ${effects}`;


export interface SceneModel {

  readonly model: string;

  readonly live: number;
  // Alpha and scale do not stop particle emitters; only parked effects are out of view.
  readonly inView: number;

  readonly drawn: number;

  readonly created: number | undefined;

  readonly age: number | undefined;

  readonly longest: number;

  readonly destroyed: number;
}

/** Backslashes would sit inside the Preload file's JASS string literals. */
export const reportedModel = (model: string) => model.replaceAll("\\", "/");

/** One line per model, its path last because a path may contain spaces. */
export const sceneModelLine = ({ model, live, inView, drawn, created, age, longest, destroyed }: SceneModel) =>
  `model ${live} ${inView} ${drawn} ${created ?? "-"} ${age ?? "-"} ${longest} ${destroyed} ${model}`;
