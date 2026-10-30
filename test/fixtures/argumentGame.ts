import type { StandaloneGame } from "../../host/play/standalone";

export const game = (args: readonly string[]): StandaloneGame => ({
  title: args.join(" "), render: { readAsset: async () => undefined }, create: async () => { throw new Error("not played"); },
});
export const plain: StandaloneGame = { title: "plain", render: { readAsset: async () => undefined }, create: async () => { throw new Error("not played"); } };
