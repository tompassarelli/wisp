// Presentation-only chat history: no simulation, rollback or synchronized state reads it.

import { f32 } from "../sim/f32";
import { idiv, imod } from "../sim/intMath";

export interface ChatLine {
  readonly rgb: number;
  readonly name: string;
  readonly text: string;
  readonly born: number;
}

export interface ChatRow {
  readonly text: string;
  readonly born: number;
}

export interface ChatLog {
  readonly lines: ChatLine[];
  readonly capacity: number;
  clock: number;
  revision: number;
}

export const createChatLog = (capacity: number): ChatLog => ({ lines: [], capacity, clock: 0.0, revision: 0 });

const HEX = "0123456789abcdef";
const hexByte = (value: number) => `${HEX.charAt(idiv(value, 16))}${HEX.charAt(imod(value, 16))}`;

export const colourCode = (rgb: number): string =>
  `|cff${hexByte(idiv(rgb, 65536))}${hexByte(imod(idiv(rgb, 256), 256))}${hexByte(imod(rgb, 256))}`;

const liftChannel = (channel: number, percent: number) => channel + idiv((255 - channel) * percent, 100);

/** `rgb` moved `percent` of the way to white, so a saturated player colour reads on a dark backdrop. */
export const lighten = (rgb: number, percent: number): number =>
  liftChannel(idiv(rgb, 65536), percent) * 65536 + liftChannel(imod(idiv(rgb, 256), 256), percent) * 256 + liftChannel(imod(rgb, 256), percent);

/** Battle.net names carry a `#1234` tag that chat never shows. */
export function chatName(name: string): string {
  const tag = name.indexOf("#");
  return tag > 0 ? name.substring(0, tag) : name;
}

export function addChatLine(log: ChatLog, rgb: number, name: string, text: string): void {
  log.lines.push({ rgb, name: chatName(name), text, born: log.clock });
  while (log.lines.length > log.capacity) log.lines.shift();
  log.revision++;
}

export function advanceChat(log: ChatLog, seconds: number): void {
  log.clock = f32(log.clock + seconds);
}

export const chatAge = (log: Readonly<ChatLog>, born: number): number => f32(log.clock - born);

/** A font's advance per glyph class, in units of the font size. */
export interface GlyphWidths {
  readonly space: number;
  /** `i j l` and thin punctuation. */
  readonly narrow: number;
  /** `f r t` and brackets. */
  readonly short: number;
  readonly lower: number;
  /** `m w`. */
  readonly wideLower: number;
  readonly upper: number;
  /** `M W`. */
  readonly wideUpper: number;
  /** Digits, symbols and every byte outside ASCII letters. */
  readonly other: number;
}

/** Warcraft's Friz Quadrata (`Fonts\FRIZQT__.TTF`), fitted to native captures and rounded up so a row never overruns. */
export const FRIZ_QUADRATA_WIDTHS: GlyphWidths = {
  space: f32(0.28),
  narrow: f32(0.28),
  short: f32(0.41),
  lower: f32(0.59),
  wideLower: f32(0.88),
  upper: f32(0.78),
  wideUpper: f32(1.0),
  other: f32(0.7),
};

const NARROW_GLYPHS = "ijlI.,:;'!|`";
const SHORT_GLYPHS = "frt-()[]\"";

export function glyphWidth(glyph: string, widths: GlyphWidths): number {
  if (glyph === " ") return widths.space;
  if (NARROW_GLYPHS.includes(glyph)) return widths.narrow;
  if (SHORT_GLYPHS.includes(glyph)) return widths.short;
  if (glyph === "m" || glyph === "w") return widths.wideLower;
  if (glyph === "M" || glyph === "W") return widths.wideUpper;
  if (glyph >= "a" && glyph <= "z") return widths.lower;
  if (glyph >= "A" && glyph <= "Z") return widths.upper;
  return widths.other;
}

/** The width of `text` in units of the font size. */
export function textWidth(text: string, widths: GlyphWidths): number {
  let width = 0.0;
  for (let index = 0; index < text.length; index++) width = f32(width + glyphWidth(text.charAt(index), widths));
  return width;
}

function fittingLength(word: string, room: number, widths: GlyphWidths): number {
  let width = 0.0;
  for (let index = 0; index < word.length; index++) {
    width = f32(width + glyphWidth(word.charAt(index), widths));
    if (width > room) return Math.max(1, index);
  }
  return word.length;
}

/**
 * Splits `text` at spaces into pieces no wider than `first` for the first piece and `width` after it,
 * in units of the font size; a word wider than its row is cut.
 */
export function wrapChat(text: string, first: number, width: number, widths: GlyphWidths): string[] {
  const pieces: string[] = [];
  let current = "";
  let used = 0.0;
  for (const word of text.split(" ")) {
    let rest = word;
    let restWidth = textWidth(rest, widths);
    const room = pieces.length === 0 ? first : width;
    const joined = current.length === 0 ? restWidth : f32(f32(used + widths.space) + restWidth);
    if (joined <= room) {
      current = current.length === 0 ? rest : `${current} ${rest}`;
      used = joined;
      continue;
    }
    if (current.length > 0) pieces.push(current);
    for (let cutRoom = pieces.length === 0 ? first : width; restWidth > cutRoom; cutRoom = width) {
      const cut = fittingLength(rest, cutRoom, widths);
      pieces.push(rest.substring(0, cut));
      rest = rest.substring(cut);
      restWidth = textWidth(rest, widths);
    }
    current = rest;
    used = restWidth;
  }
  if (current.length > 0 || pieces.length === 0) pieces.push(current);
  return pieces;
}

/** One row per wrapped piece: the first holds the coloured name, later ones start at the row's left edge. */
export function chatRows(line: ChatLine, width: number, widths: GlyphWidths): ChatRow[] {
  const first = f32(width - textWidth(`${line.name}: `, widths));
  const pieces = wrapChat(line.text, first, width, widths);
  return pieces.map((piece, index) => ({
    text: index === 0 ? `${colourCode(line.rgb)}${line.name}|r: ${piece}` : piece,
    born: line.born,
  }));
}

/** The last `count` rows of the lines younger than `seconds`, oldest first; `seconds` below 0 keeps every line. */
export function visibleChatRows(log: Readonly<ChatLog>, count: number, width: number, widths: GlyphWidths, seconds: number): ChatRow[] {
  const rows: ChatRow[] = [];
  for (let index = log.lines.length - 1; index >= 0 && rows.length < count; index--) {
    const line = log.lines[index];
    if (line === undefined || (seconds >= 0.0 && chatAge(log, line.born) >= seconds)) continue;
    const lineRows = chatRows(line, width, widths);
    for (let row = lineRows.length - 1; row >= 0 && rows.length < count; row--) rows.push(lineRows[row] as ChatRow);
  }
  return rows.reverse();
}

/** Full opacity until `fade` seconds before the line expires after `seconds`, then a straight ramp to 0. */
export function chatOpacity(age: number, seconds: number, fade: number): number {
  if (seconds < 0.0) return 1.0;
  const left = f32(seconds - age);
  if (left >= fade) return 1.0;
  return left <= 0.0 ? 0.0 : f32(left / fade);
}
