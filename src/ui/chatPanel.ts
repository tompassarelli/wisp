// A chat panel a map draws in place of Warcraft's: it only reads received lines and writes its own frames.

import { f32 } from "../sim/f32";
import { addChatLine, advanceChat, chatAge, chatOpacity, createChatLog, type ChatLog, type ChatRow, type GlyphWidths, visibleChatRows } from "./chatLog";

export interface ChatStyle {
  /** Prefix of the frames' names, unique per panel. */
  readonly name: string;
  readonly font: string;
  readonly fontSize: number;
  readonly rowHeight: number;
  /** The font's glyph advances, which decide where a row wraps. */
  readonly glyphWidths: GlyphWidths;
  /** Space between the text and the backdrop's edge, on every side. */
  readonly margin: number;
  readonly panelTexture: string;
  /** Backdrop opacity, 0 to 255. */
  readonly panelAlpha: number;
  readonly level: number;
  /** Lines kept for the history view. */
  readonly capacity: number;
  /** Rows the history view shows, growing up from the box's bottom edge. */
  readonly historyRows: number;
  /** Seconds a line stays in the recent view, the last `fadeSeconds` of them fading out. */
  readonly recentSeconds: number;
  readonly fadeSeconds: number;
  /** The name colour (0xRRGGBB) of a player slot. */
  readonly colour: (slot: number) => number;
  /** Lines to leave out, such as commands. */
  readonly ignore: (text: string) => boolean;
}

/** Screen coordinates (0.8 wide, 0.6 high, origin bottom left); rows grow upward from `bottom`. */
export interface ChatBox {
  readonly left: number;
  readonly bottom: number;
  readonly width: number;
  /** Rows the recent view shows. */
  readonly rows: number;
}

export function registerChatEvents(trigger: trigger, slots: readonly number[]): void {
  for (const slot of slots) TriggerRegisterPlayerChatEvent(trigger, Player(slot), "", false);
}

export function registerChatHistoryKey(trigger: trigger, slots: readonly number[], key: oskeytype): void {
  for (const slot of slots) BlzTriggerRegisterPlayerKeyEvent(trigger, Player(slot), key, 0, true);
}

export class ChatPanel {
  private readonly log: ChatLog;
  private readonly backdrop: framehandle;
  private readonly rowFrames: framehandle[] = [];
  private readonly shownText: string[] = [];
  private readonly shownAlpha: number[] = [];
  private rows: ChatRow[] = [];
  private rowsKey = "";
  private placedKey = "";
  private shownRows = 0;
  private backdropAlpha = -1;
  private historyOpen = false;

  constructor(private readonly style: ChatStyle) {
    this.log = createChatLog(style.capacity);
    const parent = BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0);
    this.backdrop = BlzCreateFrameByType("BACKDROP", `${style.name}Panel`, parent, "", 0);
    BlzFrameSetTexture(this.backdrop, style.panelTexture, 0, true);
    BlzFrameSetLevel(this.backdrop, style.level);
    BlzFrameSetEnable(this.backdrop, false);
    BlzFrameSetVisible(this.backdrop, false);
    for (let index = 0; index < style.historyRows; index++) {
      const row = BlzCreateFrameByType("TEXT", `${style.name}Row${index}`, parent, "", 0);
      BlzFrameSetLevel(row, style.level + 1);
      BlzFrameSetFont(row, style.font, style.fontSize, 0);
      BlzFrameSetTextAlignment(row, TEXT_JUSTIFY_MIDDLE, TEXT_JUSTIFY_LEFT);
      BlzFrameSetEnable(row, false);
      BlzFrameSetVisible(row, false);
      this.rowFrames.push(row);
      this.shownText.push("");
      this.shownAlpha.push(-1);
    }
  }

  /** Adds the line the running chat event carries; call it from the trigger's action. */
  receive(): void {
    const text = GetEventPlayerChatString();
    if (this.style.ignore(text)) return;
    const player = GetTriggerPlayer();
    addChatLine(this.log, this.style.colour(GetPlayerId(player)), GetPlayerName(player), text);
  }

  /** Opens or closes the scrollback on the machine of the player whose key event is running. */
  toggleHistory(): void {
    if (GetTriggerPlayer() === GetLocalPlayer()) this.historyOpen = !this.historyOpen;
  }

  /** Draws the panel in `box`, or hides it when `box` is undefined; `seconds` is the time since the last call. */
  update(seconds: number, box: ChatBox | undefined): void {
    advanceChat(this.log, seconds);
    const rows = box === undefined ? [] : this.currentRows(box);
    if (box === undefined || rows.length === 0) {
      this.hide();
      return;
    }
    this.place(box, rows.length);
    this.fill(rows);
  }

  private currentRows(box: ChatBox): ChatRow[] {
    const history = this.historyOpen;
    const seconds = history ? -1.0 : this.style.recentSeconds;
    let alive = 0;
    for (const line of this.log.lines) if (seconds < 0.0 || chatAge(this.log, line.born) < seconds) alive++;
    if (alive === 0) return [];
    const count = history ? this.style.historyRows : Math.min(box.rows, this.style.historyRows);
    const width = f32(box.width / this.style.fontSize);
    const key = `${this.log.revision}:${alive}:${count}:${width}:${seconds}`;
    if (key !== this.rowsKey) {
      this.rowsKey = key;
      this.rows = visibleChatRows(this.log, count, width, this.style.glyphWidths, seconds);
    }
    return this.rows;
  }

  private place(box: ChatBox, count: number): void {
    const key = `${box.left}:${box.bottom}:${box.width}:${count}`;
    if (key === this.placedKey) return;
    this.placedKey = key;
    const { rowHeight, margin, fontSize } = this.style;
    const edge = Math.max(0.0, f32(margin - f32(f32(rowHeight - fontSize) * 0.5)));
    BlzFrameClearAllPoints(this.backdrop);
    BlzFrameSetAbsPoint(this.backdrop, FRAMEPOINT_BOTTOMLEFT, f32(box.left - margin), f32(box.bottom - edge));
    BlzFrameSetAbsPoint(this.backdrop, FRAMEPOINT_TOPRIGHT, f32(box.left + box.width + margin), f32(box.bottom + f32(rowHeight * count) + edge));
    for (let index = 0; index < count; index++) {
      const row = this.rowFrames[index] as framehandle;
      BlzFrameClearAllPoints(row);
      BlzFrameSetAbsPoint(row, FRAMEPOINT_BOTTOMLEFT, box.left, f32(box.bottom + f32(rowHeight * (count - 1 - index))));
      BlzFrameSetSize(row, box.width, rowHeight);
    }
  }

  private fill(rows: readonly ChatRow[]): void {
    const history = this.historyOpen;
    let newest = 0.0;
    for (let index = 0; index < this.rowFrames.length; index++) {
      const row = this.rowFrames[index] as framehandle;
      const shown = rows[index];
      if (shown === undefined) {
        if (index < this.shownRows) BlzFrameSetVisible(row, false);
        continue;
      }
      if (this.shownText[index] !== shown.text) {
        this.shownText[index] = shown.text;
        BlzFrameSetText(row, shown.text);
      }
      const opacity = history ? 1.0 : chatOpacity(chatAge(this.log, shown.born), this.style.recentSeconds, this.style.fadeSeconds);
      newest = Math.max(newest, opacity);
      const alpha = Math.floor(f32(opacity * 255.0));
      if (this.shownAlpha[index] !== alpha) {
        this.shownAlpha[index] = alpha;
        BlzFrameSetAlpha(row, alpha);
      }
      if (index >= this.shownRows) BlzFrameSetVisible(row, true);
    }
    const backdropAlpha = Math.floor(f32(newest * this.style.panelAlpha));
    if (backdropAlpha !== this.backdropAlpha) {
      this.backdropAlpha = backdropAlpha;
      BlzFrameSetAlpha(this.backdrop, backdropAlpha);
    }
    if (this.shownRows === 0) BlzFrameSetVisible(this.backdrop, true);
    this.shownRows = rows.length;
  }

  private hide(): void {
    if (this.shownRows === 0) return;
    this.shownRows = 0;
    this.placedKey = "";
    BlzFrameSetVisible(this.backdrop, false);
    for (const row of this.rowFrames) BlzFrameSetVisible(row, false);
  }
}
