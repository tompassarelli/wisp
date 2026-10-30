import { type CommandEntry, runCli as runCliWith, runMainCli as runMainCliWith } from "../cli/cli";
import { platformLayer } from "../os/platform/layer";

export type { CommandEntry };

export const runCli = (program: string, commands: Readonly<Record<string, CommandEntry>>, argv: readonly string[], print?: (line: string) => void) =>
  runCliWith(program, commands, argv, platformLayer(), print);

export const runMainCli = (program: string, commands: Readonly<Record<string, CommandEntry>>, argv: readonly string[]) =>
  runMainCliWith(program, commands, argv, platformLayer());
