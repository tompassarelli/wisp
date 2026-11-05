export const northProgram = () => process.env["NORTH_BIN"] ?? "north";

/** The argv prefix of north's host capacity admission, ahead of a verb such as `session` or `run`. */
export const capacityCommand = (program: string = northProgram()): readonly string[] => [program, "capacity", "host"];

/** The north program that admits runs, or undefined where none is installed (CI, cloud, other machines). `NORTH_BIN` names it directly. */
export const capacityProgram = (): string | undefined => {
  const given = process.env["NORTH_BIN"];
  if (given !== undefined) return given;
  return Bun.which("north", { PATH: process.env["PATH"] ?? "" }) === null ? undefined : "north";
};

/** A verb `north capacity host` admits through; without one it prints its usage and exits 2. */
export type CapacityVerb = "session" | "run";

/** `capacityCommand`, `verb` and `args`, split into the program and its arguments for a spawn. */
export const capacitySpawn = (program: string | undefined, verb: CapacityVerb, args: readonly string[]) => {
  const [command = "", ...rest] = [...capacityCommand(program), verb, ...args];
  return [command, rest] as const;
};
