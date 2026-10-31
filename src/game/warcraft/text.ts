import type { Lowering } from "./lowering";

export const text: Lowering = {
  formatInt: "I2S($1)",
  formatReal: "R2S($1)",
  formatRealWidth: "R2SW($1, $2, $3)",
  parseInt: "S2I($1)",
  parseReal: "S2R($1)",
  toReal: "I2R($1)",
  truncate: "R2I($1)",
  textLength: "StringLength($1)",
};
