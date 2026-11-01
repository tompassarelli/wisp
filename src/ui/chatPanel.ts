// A chat panel a map draws in place of Warcraft's: it only reads received lines and writes its own frames.

import { addChatEvent, addKeyEvent, chatText, type OsKey } from "wisp/game/input";
import type { Events } from "wisp/game/events";
import { clearFramePoints, createFrameByType, FramePoint, originFrame, OriginFrame, setFrameAbsPoint, setFrameAlpha, setFrameEnabled, setFrameFont, setFrameLevel, setFrameSize, setFrameText, setFrameTextAlignment, setFrameTexture, setFrameVisible, TextAlignment, type Frame } from "wisp/game/frames";
import { eventPlayer, localPlayer, player, playerName, playerSlot } from "wisp/game/players";
import { f32 } from "../sim/f32";
import { imod } from "../sim/intMath";
import { type ChatFrameLayout, type ChatFrameMeasures, type ChatRect, chatFrameLayout } from "./chatFrame";
import { addChatLine, advanceChat, chatAge, chatOpacity, chatRowCount, colourCode, createChatLog, type ChatLog, type ChatRow, type GlyphWidths, visibleChatRows } from "./chatLog";

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
  /** The look of the framed box (`ChatSlot`); a panel without it draws only the recent view. */
  readonly frame?: ChatFrameStyle;
}

/** The title bar along the top of the framed box. */
export interface ChatTitleStyle {
  /** The text, colour codes and all. */
  readonly text: string;
  readonly fontSize: number;
  /** The bar's fill, none when undefined, and its opacity, 0 to 255. */
  readonly texture?: string;
  readonly alpha: number;
}

/** The framed box: its backdrop, drawn at `panelAlpha`, its optional title bar, scrollbar and entry line. */
export interface ChatFrameStyle {
  readonly panelTexture: string;
  /** The title bar; without it the box has none and the history uses the space. */
  readonly title?: ChatTitleStyle;
  /** The fill of the scrollbar's track and thumb. */
  readonly barTexture: string;
  /** The fill of the entry line's field. */
  readonly fieldTexture: string;
  /** The entry line's text while the player is not typing, and its colour, 0xRRGGBB. */
  readonly placeholder: string;
  readonly placeholderColour: number;
}

/** Screen coordinates (0.8 wide, 0.6 high, origin bottom left); rows grow upward from `bottom`. */
export interface ChatBox {
  readonly left: number;
  readonly bottom: number;
  readonly width: number;
  /** Rows the recent view shows. */
  readonly rows: number;
}

/** The rectangle the framed box fills, always shown: a title bar when the style has one, the history with its scrollbar and, in the native window, the entry line along the bottom; as many rows as the rectangle holds, at most `historyRows`. */
export interface ChatSlot {
  readonly left: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export function registerChatEvents(events: Events, slots: readonly number[]): void {
  for (const slot of slots) addChatEvent(events, player(slot), "", false);
}

export function registerChatHistoryKey(events: Events, slots: readonly number[], key: OsKey): void {
  for (const slot of slots) addKeyEvent(events, player(slot), key, 0, true);
}

const TRACK_ALPHA = 70, THUMB_ALPHA = 200, FIELD_ALPHA = 170;
const CARET_BLINKS_PER_SECOND = 2.0;
const TITLE_ROWS = f32(1.6), ENTRY_ROWS = f32(1.4), BAR_ROWS = f32(0.35);

/** Whether this runtime has Wisp's own chat line: the native window does, and Warcraft III types into its Enter box instead. */
const hasChatEntry = (): boolean => typeof WispChatEntryText === "function";

interface FramedParts {
  readonly panel: Frame;
  readonly track: Frame;
  readonly thumb: Frame;
  readonly title: TitleParts | undefined;
}

interface TitleParts {
  readonly text: Frame;
  readonly bar: Frame | undefined;
}

const setRect = (frame: Frame, rect: ChatRect): void => {
  clearFramePoints(frame);
  setFrameAbsPoint(frame, FramePoint.bottomLeft, rect.left, rect.bottom);
  setFrameAbsPoint(frame, FramePoint.topRight, f32(rect.left + rect.width), f32(rect.bottom + rect.height));
};

export class ChatPanel {
  private readonly log: ChatLog;
  private readonly backdrop: Frame;
  private readonly rowFrames: Frame[] = [];
  private readonly shownText: string[] = [];
  private readonly shownAlpha: number[] = [];
  private readonly rowShown: boolean[] = [];
  /** The framed box's backdrop, scrollbar track and thumb, and its title text and bar when the style has them. */
  private readonly framed: FramedParts | undefined;
  /** The entry line's field and text, made only where the runtime has a chat line. */
  private readonly entry: readonly [field: Frame, text: Frame] | undefined;
  private rows: ChatRow[] = [];
  private rowsKey = "";
  private placedKey = "";
  private backdropAlpha = -1;
  private backdropShown = false;
  private partsShown = false;
  private entryShown = false;
  private historyOpen = false;
  private framedSlot: ChatSlot | undefined;
  private framedRevision = -1;
  private framedRows = 0;
  private shownTyping: string | undefined;
  private shownCaret = false;
  private entryWritten = false;
  private readonly placeholder: string;

  constructor(private readonly style: ChatStyle) {
    this.log = createChatLog(style.capacity);
    this.placeholder = style.frame === undefined ? "" : `${colourCode(style.frame.placeholderColour)}${style.frame.placeholder}`;
    this.backdrop = this.backdropFrame(`${style.name}Panel`, style.panelTexture, style.level);
    for (let index = 0; index < style.historyRows; index++) {
      this.rowFrames.push(this.textFrame(`${style.name}Row${index}`, style.fontSize, style.level + 1));
      this.shownText.push("");
      this.shownAlpha.push(-1);
      this.rowShown.push(false);
    }
    const frame = style.frame;
    if (frame !== undefined) {
      const panel = this.backdropFrame(`${style.name}FramedPanel`, frame.panelTexture, style.level);
      setFrameAlpha(panel, style.panelAlpha);
      const track = this.backdropFrame(`${style.name}Track`, frame.barTexture, style.level + 1);
      setFrameAlpha(track, TRACK_ALPHA);
      const thumb = this.backdropFrame(`${style.name}Thumb`, frame.barTexture, style.level + 2);
      setFrameAlpha(thumb, THUMB_ALPHA);
      this.framed = { panel, track, thumb, title: frame.title === undefined ? undefined : this.titleParts(frame.title) };
    }
    if (!hasChatEntry()) return;
    const field = this.backdropFrame(`${style.name}EntryField`, frame?.fieldTexture ?? style.panelTexture, style.level + 1);
    setFrameAlpha(field, FIELD_ALPHA);
    this.entry = [field, this.textFrame(`${style.name}EntryText`, style.fontSize, style.level + 2)];
  }

  private titleParts(title: ChatTitleStyle): TitleParts {
    const name = this.style.name;
    const text = this.textFrame(`${name}Title`, title.fontSize, this.style.level + 2);
    setFrameText(text, title.text);
    const bar = title.texture === undefined ? undefined : this.backdropFrame(`${name}TitleBar`, title.texture, this.style.level + 1);
    if (bar !== undefined) setFrameAlpha(bar, title.alpha);
    return { text, bar };
  }

  private backdropFrame(name: string, texture: string, level: number): Frame {
    const frame = createFrameByType("BACKDROP", name, originFrame(OriginFrame.gameUi, 0), "", 0);
    setFrameTexture(frame, texture, 0, true);
    setFrameLevel(frame, level);
    setFrameEnabled(frame, false);
    setFrameVisible(frame, false);
    return frame;
  }

  private textFrame(name: string, fontSize: number, level: number): Frame {
    const frame = createFrameByType("TEXT", name, originFrame(OriginFrame.gameUi, 0), "", 0);
    setFrameLevel(frame, level);
    setFrameFont(frame, this.style.font, fontSize, 0);
    setFrameTextAlignment(frame, TextAlignment.middle, TextAlignment.left);
    setFrameEnabled(frame, false);
    setFrameVisible(frame, false);
    return frame;
  }

  /** Adds the line the running chat event carries; call it from the trigger's action. */
  receive(): void {
    const text = chatText();
    if (this.style.ignore(text)) return;
    const player = eventPlayer();
    addChatLine(this.log, this.style.colour(playerSlot(player)), playerName(player), text);
  }

  /** Opens or closes the scrollback on the machine of the player whose key event is running. */
  toggleHistory(): void {
    if (eventPlayer() === localPlayer()) this.historyOpen = !this.historyOpen;
  }

  /** Whether the player has the entry line open, which only the native window has. */
  isTyping(): boolean {
    return this.entry !== undefined && WispChatEntryText() !== undefined;
  }

  /** Draws the recent view in a `ChatBox`, the framed box in a `ChatSlot` (with a `frame` style), or nothing when `box` is undefined; `seconds` is the time since the last call. */
  update(seconds: number, box: ChatBox | ChatSlot | undefined): void {
    advanceChat(this.log, seconds);
    const typing = this.entry === undefined ? undefined : WispChatEntryText();
    const frame = this.style.frame;
    if (box !== undefined && "height" in box) {
      if (frame !== undefined) this.drawFramed(box, typing);
      return;
    }
    this.drawRecent(box, typing);
  }

  /** The recent view: lines fade out after `recentSeconds`; while the player types, the entry line sits at the box's bottom with every kept line above it. */
  private drawRecent(box: ChatBox | undefined, typing: string | undefined): void {
    this.leaveFramed();
    const rows = box === undefined ? [] : this.recentRows(box, typing !== undefined);
    if (box === undefined || (rows.length === 0 && typing === undefined)) {
      this.hide();
      return;
    }
    this.placeRecent(box, rows.length, typing !== undefined);
    let newest = typing === undefined ? 0.0 : 1.0;
    for (let index = 0; index < this.rowFrames.length; index++) {
      const shown = rows[index];
      const opacity = shown === undefined || typing !== undefined || this.historyOpen ? 1.0 : chatOpacity(chatAge(this.log, shown.born), this.style.recentSeconds, this.style.fadeSeconds);
      if (shown !== undefined) newest = Math.max(newest, opacity);
      this.showRow(index, shown, opacity);
    }
    this.showBackdrop(Math.floor(f32(newest * this.style.panelAlpha)));
    this.showEntry(typing, false);
  }

  private leaveFramed(): void {
    if (!this.partsShown) return;
    this.showParts(false);
    this.placedKey = "";
    this.framedSlot = undefined;
    for (let index = 0; index < this.rowFrames.length; index++) this.showRow(index, undefined, 1.0);
  }

  /** The recent view's backdrop and `count` rows in `box`, above the entry line while the player types. */
  private placeRecent(box: ChatBox, count: number, typing: boolean): void {
    const { rowHeight, margin, fontSize } = this.style;
    const entryHeight = typing ? f32(rowHeight * ENTRY_ROWS) : 0.0;
    const key = `${box.left}:${box.bottom}:${box.width}:${count}:${entryHeight}`;
    if (key === this.placedKey) return;
    this.placedKey = key;
    const rowsBottom = typing ? f32(box.bottom + f32(entryHeight + margin)) : box.bottom;
    const edge = Math.max(0.0, f32(margin - f32(f32(rowHeight - fontSize) * 0.5)));
    const height = f32(f32(f32(rowsBottom - box.bottom) + f32(rowHeight * count)) + f32(edge * 2.0));
    setRect(this.backdrop, { left: f32(box.left - margin), bottom: f32(box.bottom - edge), width: f32(box.width + f32(margin * 2.0)), height });
    this.placeRows(box.left, rowsBottom, box.width, count);
    if (typing) this.placeEntry({ left: box.left, bottom: box.bottom, width: box.width, height: entryHeight }, false);
  }

  private recentRows(box: ChatBox, typing: boolean): ChatRow[] {
    const seconds = this.historyOpen || typing ? -1.0 : this.style.recentSeconds;
    let alive = 0;
    for (const line of this.log.lines) if (seconds < 0.0 || chatAge(this.log, line.born) < seconds) alive++;
    if (alive === 0) return [];
    const count = this.historyOpen ? this.style.historyRows : Math.min(box.rows, this.style.historyRows);
    return this.wrappedRows(count, f32(box.width / this.style.fontSize), seconds, alive);
  }

  private wrappedRows(count: number, width: number, seconds: number, alive: number): ChatRow[] {
    const key = `${this.log.revision}:${alive}:${count}:${width}:${seconds}`;
    if (key !== this.rowsKey) {
      this.rowsKey = key;
      this.rows = visibleChatRows(this.log, count, width, this.style.glyphWidths, seconds);
    }
    return this.rows;
  }

  /** The framed box, always shown: the title bar when the style has one, every kept line newest at the bottom with the scrollbar beside them, and the entry line under them where the runtime has one. */
  private drawFramed(slot: ChatSlot, typing: string | undefined): void {
    if (slot !== this.framedSlot || this.log.revision !== this.framedRevision) {
      const measures = this.measures();
      const entry = this.entry !== undefined;
      const width = f32(chatFrameLayout(slot, measures, entry, 0, this.style.historyRows).rows.width / this.style.fontSize);
      const layout = chatFrameLayout(slot, measures, entry, chatRowCount(this.log, width, this.style.glyphWidths), this.style.historyRows);
      this.framedSlot = slot;
      this.framedRevision = this.log.revision;
      this.framedRows = layout.rowCount;
      this.rows = visibleChatRows(this.log, layout.rowCount, width, this.style.glyphWidths, -1.0);
      this.rowsKey = "";
      this.placeFramed(slot, layout);
    }
    const count = this.framedRows, rows = this.rows;
    const empty = count - rows.length;
    for (let index = 0; index < this.rowFrames.length; index++) this.showRow(index, index < empty || index >= count ? undefined : rows[index - empty], 1.0);
    if (this.backdropShown) {
      this.backdropShown = false;
      setFrameVisible(this.backdrop, false);
    }
    this.showParts(true);
    this.showEntry(typing, true);
  }

  private measures(): ChatFrameMeasures {
    const rowHeight = this.style.rowHeight;
    const titled = this.framed?.title !== undefined;
    return { rowHeight, margin: this.style.margin, titleHeight: titled ? f32(rowHeight * TITLE_ROWS) : 0.0, barWidth: f32(rowHeight * BAR_ROWS), entryHeight: f32(rowHeight * ENTRY_ROWS) };
  }

  private placeFramed(slot: ChatSlot, layout: ChatFrameLayout): void {
    const parts = this.framed as FramedParts;
    setRect(parts.panel, slot);
    setRect(parts.track, layout.track);
    setRect(parts.thumb, layout.thumb);
    if (parts.title !== undefined && layout.title !== undefined) {
      setRect(parts.title.text, layout.title.text);
      if (parts.title.bar !== undefined) setRect(parts.title.bar, layout.title.bar);
    }
    this.placeRows(layout.rows.left, layout.rows.bottom, layout.rows.width, layout.rowCount);
    if (layout.entry !== undefined) this.placeEntry(layout.entry, true);
  }

  private placeRows(left: number, bottom: number, width: number, count: number): void {
    const rowHeight = this.style.rowHeight;
    for (let index = 0; index < count; index++) {
      const row = this.rowFrames[index] as Frame;
      clearFramePoints(row);
      setFrameAbsPoint(row, FramePoint.bottomLeft, left, f32(bottom + f32(rowHeight * (count - 1 - index))));
      setFrameSize(row, width, rowHeight);
    }
  }

  /** Puts the entry line in `rect`; `clickable` tells the runtime that a click there opens it. */
  private placeEntry(rect: ChatRect, clickable: boolean): void {
    const entry = this.entry;
    if (entry === undefined) return;
    const margin = this.style.margin;
    setRect(entry[0], rect);
    setRect(entry[1], { left: f32(rect.left + margin), bottom: rect.bottom, width: f32(rect.width - f32(margin * 2.0)), height: rect.height });
    if (clickable) WispSetChatEntryArea(rect.left, rect.bottom, rect.width, rect.height);
    else WispSetChatEntryArea(0.0, 0.0, 0.0, 0.0);
  }

  private showRow(index: number, row: ChatRow | undefined, opacity: number): void {
    const frame = this.rowFrames[index] as Frame;
    const visible = row !== undefined;
    if (row !== undefined) {
      if (this.shownText[index] !== row.text) {
        this.shownText[index] = row.text;
        setFrameText(frame, row.text);
      }
      const alpha = Math.floor(f32(opacity * 255.0));
      if (this.shownAlpha[index] !== alpha) {
        this.shownAlpha[index] = alpha;
        setFrameAlpha(frame, alpha);
      }
    }
    if (this.rowShown[index] !== visible) {
      this.rowShown[index] = visible;
      setFrameVisible(frame, visible);
    }
  }

  private showBackdrop(alpha: number): void {
    if (alpha !== this.backdropAlpha) {
      this.backdropAlpha = alpha;
      setFrameAlpha(this.backdrop, alpha);
    }
    if (!this.backdropShown) {
      this.backdropShown = true;
      setFrameVisible(this.backdrop, true);
    }
  }

  private showParts(visible: boolean): void {
    if (visible === this.partsShown) return;
    this.partsShown = visible;
    const parts = this.framed;
    if (parts === undefined) return;
    for (const part of [parts.panel, parts.track, parts.thumb, parts.title?.text, parts.title?.bar]) if (part !== undefined) setFrameVisible(part, visible);
  }

  /** The entry line: the typed text with a blinking caret while the player types, the placeholder in a framed box while they do not, and nothing otherwise. */
  private showEntry(typing: string | undefined, framed: boolean): void {
    const entry = this.entry;
    if (entry === undefined) return;
    const visible = typing !== undefined || framed;
    if (visible !== this.entryShown) {
      this.entryShown = visible;
      setFrameVisible(entry[0], visible);
      setFrameVisible(entry[1], visible);
      if (!visible) WispSetChatEntryArea(0.0, 0.0, 0.0, 0.0);
    }
    if (!visible) return;
    const caret = typing !== undefined && imod(Math.floor(f32(this.log.clock * CARET_BLINKS_PER_SECOND)), 2) === 0;
    if (typing === this.shownTyping && caret === this.shownCaret && this.entryWritten) return;
    this.entryWritten = true;
    this.shownTyping = typing;
    this.shownCaret = caret;
    setFrameText(entry[1], typing === undefined ? this.placeholder : caret ? `${typing}|` : typing);
  }

  private hide(): void {
    this.showEntry(undefined, false);
    if (!this.backdropShown) return;
    this.backdropShown = false;
    this.placedKey = "";
    setFrameVisible(this.backdrop, false);
    for (let index = 0; index < this.rowFrames.length; index++) this.showRow(index, undefined, 1.0);
  }
}
