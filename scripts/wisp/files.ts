import { readFileSync } from "node:fs";

export const readTextOrUndefined = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};
