import type { Lowering } from "./lowering";

export const files: Lowering = {
  clearFileLines: "PreloadGenClear()",
  startFile: "PreloadGenStart()",
  addFileLine: "Preload($1)",
  endFile: "PreloadGenEnd($1)",
  preloadAsset: "Preload($1)",
};
