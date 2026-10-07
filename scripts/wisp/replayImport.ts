import { ReplayParser, type Action, type BasicReplayInformation, type GameDataBlock } from "w3gjs";
import { decodeActionRecords, type ActionRecord } from "./lan/actions";
import { parseActionLog } from "./engine/actionLog";

export interface ReplayCommand {
  readonly turn: number;
  readonly timeMs: number;
  /** Offset in the decompressed game-data stream, not the compressed .w3g. */
  readonly offset: number;
  readonly playerId: number;
  readonly raw: string;
  readonly actions: readonly ActionRecord[];
}

export interface NativeReplay {
  readonly format: "wisp-w3g-actions-1";
  readonly engine: BasicReplayInformation["subheader"];
  readonly players: BasicReplayInformation["metadata"]["playerRecords"];
  readonly slots: BasicReplayInformation["metadata"]["slotRecords"];
  readonly map: BasicReplayInformation["metadata"]["map"];
  readonly turns: number;
  readonly timeMs: number;
  readonly commands: readonly ReplayCommand[];
  readonly records: readonly { readonly offset: number; readonly id: number; readonly raw: string }[];
}

// w3gjs 4.3.0's private fields are ordinary properties. This narrow adapter
// retains bytes at its existing block boundaries before its melee decoder drops them.
interface RawGameParser {
  parser: { offset: number; buffer: Buffer };
  actionParser: { parse: (bytes: Buffer, post202?: boolean) => Action[] };
  parseBlock: () => GameDataBlock | null;
}

export async function importNativeReplay(bytes: Buffer): Promise<NativeReplay> {
  const parser = new ReplayParser();
  const low = (parser as unknown as { gameDataParser: RawGameParser }).gameDataParser;
  const records: { offset: number; id: number; raw: string }[] = [];
  const commands: ReplayCommand[] = [];
  let turn = -1;
  let timeMs = 0;
  let pending: { offset: number; raw: string; actions: ActionRecord[] }[] = [];
  low.actionParser.parse = raw => {
    pending.push({ offset: low.parser.offset, raw: raw.toString("hex"), actions: decodeActionRecords(raw) });
    return [];
  };
  const parseBlock = low.parseBlock.bind(low);
  low.parseBlock = () => {
    const offset = low.parser.offset;
    const block = parseBlock();
    records.push({ offset, id: low.parser.buffer[offset] ?? 0, raw: low.parser.buffer.subarray(offset, low.parser.offset).toString("hex") });
    return block;
  };
  parser.on("gamedatablock", (block: GameDataBlock) => {
    if (block.id !== 0x1f && block.id !== 0x1e) return;
    // A zero-duration continuation belongs to the same host turn.
    if (block.timeIncrement > 0) turn++;
    timeMs += block.timeIncrement;
    block.commandBlocks.forEach((command, index) => {
      const raw = pending[index];
      if (raw === undefined) throw new Error("w3gjs action boundaries changed");
      commands.push({ turn, timeMs, playerId: command.playerId, ...raw });
    });
    pending = [];
  });
  const info = await parser.parse(bytes);
  return { format: "wisp-w3g-actions-1", engine: info.subheader, players: info.metadata.playerRecords, slots: info.metadata.slotRecords, map: info.metadata.map, turns: turn + 1, timeMs, commands, records };
}

/** Compare every retained action with the same host's decoded action log. */
export function compareReplayHost(replay: NativeReplay, hostText: string) {
  const host = parseActionLog(hostText).actions;
  const actions = replay.commands.flatMap(command => command.actions.map(action => ({ ...action, turn: command.turn, pid: command.playerId })));
  const differences: string[] = [];
  if (host.length !== actions.length) differences.push(`action count: host ${host.length}, replay ${actions.length}`);
  for (let index = 0; index < Math.max(host.length, actions.length); index++) {
    const a = host[index];
    const b = actions[index];
    if (a === undefined || b === undefined) continue;
    if (a.turn !== b.turn || a.pid !== b.pid || a.kind !== b.kind || a.text !== b.text) differences.push(`action ${index}: host turn ${a.turn} p${a.pid} ${a.kind} ${a.text}; replay turn ${b.turn} p${b.pid} ${b.kind} ${b.text}`);
  }
  return { hostActions: host.length, replayActions: actions.length, differences };
}
