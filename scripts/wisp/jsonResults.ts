import { Console } from "effect";

export const emitJson = (command: string, result: Readonly<Record<string, unknown>>) =>
  Console.log(JSON.stringify({ schema: 1, command, ...result }));
