import { readFileSync, renameSync, writeFileSync } from "node:fs";

export const readTextOrUndefined = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

/** Writes `data` beside `path`, then renames it over `path`, so a reader sees the old file or the new one, never part of one. */
export const writeAtomic = (path: string, data: string | Uint8Array, options?: { readonly mode?: number }) => {
  const next = `${path}.${process.pid}.next`;
  writeFileSync(next, data, options);
  renameSync(next, path);
};
