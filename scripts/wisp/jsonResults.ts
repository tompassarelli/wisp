import { Console } from "effect";

export const emitJson = (command: string, result: Readonly<Record<string, unknown>>) => {
  const source = (result.type === "failure" || result.ok === false) && typeof result.message === "string"
    ? /(?:^|[\s("'])([^\s():"']+\.ts:[1-9]\d*)(?::\d+)?(?=$|[\s),:])/.exec(result.message)?.[1]
    : undefined;
  return Console.log(JSON.stringify({ schema: 1, command, ...(source === undefined ? {} : { source }), ...result }));
};
