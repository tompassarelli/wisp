import { f32 } from "../../src/sim/f32";

/**
 * Script rules Smashcraft relies on outside #56–#61's families: number and
 * text conversions, player slots, frame reads, and synchronized messages with
 * the triggers that receive them (wisp#50).
 */

const list = (values: readonly string[]) => values.join(",");
const scaled = (value: number) => `${Math.floor(value * 128)}`;

function controller(player: player): string {
  const control = GetPlayerController(player);
  if (control === MAP_CONTROL_USER) return "user";
  if (control === MAP_CONTROL_COMPUTER) return "computer";
  if (control === MAP_CONTROL_NONE) return "none";
  return "other";
}

function slotState(player: player): string {
  const state = GetPlayerSlotState(player);
  if (state === PLAYER_SLOT_STATE_PLAYING) return "playing";
  if (state === PLAYER_SLOT_STATE_EMPTY) return "empty";
  if (state === PLAYER_SLOT_STATE_LEFT) return "left";
  return "other";
}

/** Rows read at once, the same on every client. */
export function immediateCases(this: void): string[] {
  const rows: string[] = [];
  rows.push(`r2s=${list([R2S(1), R2S(f32(0.1)), R2S(-1.5), R2S(f32(123456.789)), R2S(0)])}`);
  // 0.0625 and 0.3125 times 1000 end in exactly .5: the tie decides the rounding rule.
  rows.push(`r2s-ties=${list([R2S(0.0625), R2S(0.3125), R2S(-0.0625), R2S(0.1875)])}`);
  rows.push(`r2sw=${list([R2SW(1.5, 8, 2), R2SW(-0.0625, 1, 3), R2SW(f32(3.14159), 0, 0), R2SW(2.5, 0, 0)])}`);
  rows.push(`i2s=${list([I2S(0), I2S(-7), I2S(2147483647), I2S(-2147483647 - 1)])}`);
  rows.push(`r2i=${list([I2S(R2I(f32(1.9))), I2S(R2I(f32(-1.9))), I2S(R2I(f32(0.999999))), I2S(R2I(-0.5))])}`);
  rows.push(`s2i=${list(["12", "12abc", " -7", "+5", "", "x1", "2147483647", "3.9", "00012", "-0"].map(text => I2S(S2I(text))))}`);
  rows.push(`s2r=${list(["1.5x", ".5", "-2.25", "1e3", "abc", " 7.25", "3."].map(text => scaled(S2R(text))))}`);
  rows.push(`player-controllers=${list([0, 1, 2, 3].map(slot => controller(Player(slot))))}`);
  rows.push(`player-slot-states=${list([0, 1, 2, 3].map(slot => slotState(Player(slot))))}`);

  const game = BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0);
  const parent = BlzCreateFrameByType("FRAME", "ScriptRulesParent", game, "", 0);
  const first = BlzCreateFrameByType("TEXT", "ScriptRulesFirst", parent, "", 0);
  const second = BlzCreateFrameByType("FRAME", "ScriptRulesSecond", parent, "", 0);
  const box = BlzCreateFrameByType("EDITBOX", "ScriptRulesBox", parent, "", 0);
  rows.push(`frame-children=${list([I2S(BlzFrameGetChildrenCount(parent)), BlzFrameGetName(BlzFrameGetChild(parent, 0)), BlzFrameGetName(BlzFrameGetChild(parent, 1)), I2S(BlzFrameGetChildrenCount(first))])}`);
  rows.push(`frame-enabled-default=${BlzFrameGetEnable(second) ? "true" : "false"}`);
  BlzFrameSetText(first, "abc");
  rows.push(`frame-text-read=${BlzFrameGetText(first)}`);
  rows.push(`frame-text-limit-default=${I2S(BlzFrameGetTextSizeLimit(box))}`);
  BlzFrameSetTextSizeLimit(box, 3);
  BlzFrameSetText(box, "abcdef");
  rows.push(`frame-text-limit-on-set=${BlzFrameGetText(box)}`);
  BlzFrameSetVisible(parent, false);
  rows.push(`frame-visible-under-hidden-parent=${BlzFrameIsVisible(second) ? "true" : "false"},${BlzFrameIsVisible(parent) ? "true" : "false"}`);
  BlzDestroyFrame(parent);
  return rows;
}

/** Data lengths around Warcraft's documented limit of about 255 bytes for prefix and data together. */
export const SYNC_LENGTHS = [200, 251, 252, 300];
const SYNC_PREFIX = "sr50";
const SYNC_LONG_PREFIX = "sr5L";
const SYNC_DESTROY_PREFIX = "sr5D";

/**
 * Each client sends the same messages 0.25 s in; the rows, written 2 s in,
 * list what every client received from each sender in arrival order.
 */
export function syncCases(this: void, done: (this: void, rows: readonly string[]) => void): void {
  const received: string[][] = [[], []];
  const lengths: string[][] = [[], []];
  const destroyed: string[] = [];
  const mismatched: string[] = [];
  const log = (label: string) => () => {
    const sender = GetPlayerId(GetTriggerPlayer());
    const data = BlzGetTriggerSyncData();
    if (BlzGetTriggerSyncPrefix() !== SYNC_PREFIX || data.substring(1) !== I2S(sender)) mismatched.push(`${label}${data}`);
    received[sender]?.push(`${label}${data}`);
  };
  const first = CreateTrigger();
  const second = CreateTrigger();
  const long = CreateTrigger();
  const doomed = CreateTrigger();
  for (const slot of [0, 1]) {
    BlzTriggerRegisterPlayerSyncEvent(first, Player(slot), SYNC_PREFIX, false);
    BlzTriggerRegisterPlayerSyncEvent(second, Player(slot), SYNC_PREFIX, false);
    BlzTriggerRegisterPlayerSyncEvent(long, Player(slot), SYNC_LONG_PREFIX, false);
  }
  BlzTriggerRegisterPlayerSyncEvent(doomed, Player(0), SYNC_DESTROY_PREFIX, false);
  TriggerAddAction(first, log("A"));
  TriggerAddAction(second, log("B"));
  TriggerAddAction(long, () => {
    lengths[GetPlayerId(GetTriggerPlayer())]?.push(I2S(StringLength(BlzGetTriggerSyncData())));
  });
  TriggerAddAction(doomed, () => {
    destroyed.push("1");
    DestroyTrigger(doomed);
  });
  TriggerAddAction(doomed, () => {
    destroyed.push("2");
  });

  const sent: string[] = [];
  TimerStart(CreateTimer(), 0.25, false, () => {
    const slot = GetPlayerId(GetLocalPlayer());
    const send = (prefix: string, data: string) => sent.push(BlzSendSyncData(prefix, data) ? "1" : "0");
    send(SYNC_PREFIX, `a${slot}`);
    send(SYNC_PREFIX, `b${slot}`);
    for (const length of SYNC_LENGTHS) {
      let data = "";
      for (let index = 0; index < length; index++) data += "x";
      send(SYNC_LONG_PREFIX, data);
    }
    if (slot === 0) {
      BlzSendSyncData(SYNC_DESTROY_PREFIX, "d");
      BlzSendSyncData(SYNC_DESTROY_PREFIX, "d");
    }
  });
  TimerStart(CreateTimer(), 2, false, () => {
    done([
      `sync-send-returns=${list(sent)}`,
      `sync-order-from-p0=${list(received[0] ?? [])}`,
      `sync-order-from-p1=${list(received[1] ?? [])}`,
      `sync-lengths-from-p0=${list(lengths[0] ?? [])}`,
      `sync-lengths-from-p1=${list(lengths[1] ?? [])}`,
      `sync-sender-mismatches=${list(mismatched)}`,
      `trigger-destroyed-in-own-action=${destroyed.join("")}`,
    ]);
  });
}
