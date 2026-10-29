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

/** Splits `text` at spaces into pieces of at most `width` characters; a word longer than `width` is cut. */
export function wrapChat(text: string, width: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    let rest = word;
    while (rest.length > width) {
      if (current.length > 0) {
        pieces.push(current);
        current = "";
      }
      pieces.push(rest.substring(0, width));
      rest = rest.substring(width);
    }
    if (current.length === 0) current = rest;
    else if (current.length + 1 + rest.length <= width) current = `${current} ${rest}`;
    else {
      pieces.push(current);
      current = rest;
    }
  }
  if (current.length > 0 || pieces.length === 0) pieces.push(current);
  return pieces;
}

/** One row per wrapped piece: the first holds the coloured name, later ones sit under the message, not the name. */
export function chatRows(line: ChatLine, width: number): ChatRow[] {
  const head = `${line.name}: `;
  const indent = " ".repeat(head.length);
  const pieces = wrapChat(line.text, Math.max(8, width - head.length));
  return pieces.map((piece, index) => ({
    text: index === 0 ? `${colourCode(line.rgb)}${line.name}|r: ${piece}` : `${indent}${piece}`,
    born: line.born,
  }));
}

/** The last `count` rows of the lines younger than `seconds`, oldest first; `seconds` below 0 keeps every line. */
export function visibleChatRows(log: Readonly<ChatLog>, count: number, width: number, seconds: number): ChatRow[] {
  const rows: ChatRow[] = [];
  for (let index = log.lines.length - 1; index >= 0 && rows.length < count; index--) {
    const line = log.lines[index];
    if (line === undefined || (seconds >= 0.0 && chatAge(log, line.born) >= seconds)) continue;
    const lineRows = chatRows(line, width);
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
