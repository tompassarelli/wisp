import type { StandaloneGame } from "../play/standalone";
import type { NativeGameModule } from "./simProtocol";

type GameExport = StandaloneGame | ((args: readonly string[]) => StandaloneGame | Promise<StandaloneGame>);

/** The game a worker thread imports from `source`: the export itself, or what it returns when called with the player's flags. */
export async function loadGame(source: NativeGameModule): Promise<StandaloneGame> {
  const exported = (await import(source.module) as Record<string, GameExport | undefined>)[source.export];
  if (exported === undefined) throw new Error(`${source.module} exports no ${source.export}`);
  return typeof exported === "function" ? exported(source.arguments ?? []) : exported;
}
