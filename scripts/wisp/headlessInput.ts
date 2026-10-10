import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Predicate } from "effect";
import type { ClientFiles } from "../../src/headless/client";
import type { Lockstep } from "../../src/headless/lockstep";
import { hostPath } from "./boundary";

/** The file Warcraft writes for PreloadGenEnd, byte for byte: Preload lines in a JASS function, with its CRLF and tab whitespace. */
export function writtenPreloadFile(lines: readonly string[]): string {
  return `function PreloadFiles takes nothing returns nothing\n\r\n\tcall PreloadStart()\r\n${lines.map((line) => `\tcall Preload( "${line}" )\r\n`).join("")}\tcall PreloadEnd( 0.0 )\r\n\nendfunction\n\n\r\n`;
}

const TOOLTIP = /^\s*call BlzSetAbilityTooltip\('\$wsl', "(.*)", (\d+)\)\s*$/gm;

export function fileIoChunks(text: string): string[] {
  const chunks: string[] = [];
  for (const [, chunk = "", level = "0"] of text.matchAll(TOOLTIP)) chunks[Number(level)] = chunk;
  return Array.from(chunks, (chunk) => chunk ?? "");
}

export function customMapData(directory: string): ClientFiles {
  mkdirSync(directory, { recursive: true });
  return {
    written: (name, lines) => {
      const path = hostPath(directory, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, writtenPreloadFile(lines));
    },
    read: (name) => {
      try {
        return fileIoChunks(readFileSync(hostPath(directory, name), "utf8"));
      } catch (error) {
        if (Predicate.isObject(error) && error.code === "ENOENT") return undefined;
        throw error;
      }
    },
  };
}

export interface TypedInput {

  read(): readonly string[];
  close(): void;
}

export function typedFile(path: string): TypedInput {
  const fd = openSync(path, "w+");
  const buffer = Buffer.alloc(64 * 1024);
  let offset = 0;
  let partial = "";
  return {
    read: () => {
      const typed: string[] = [];
      while (offset < fstatSync(fd).size) {
        const bytes = readSync(fd, buffer, 0, buffer.length, offset);
        if (bytes <= 0) break;
        offset += bytes;
        const lines = (partial + buffer.toString("latin1", 0, bytes)).split("\n");
        partial = lines.pop() ?? "";
        typed.push(...lines);
      }
      return typed;
    },
    close: () => closeSync(fd),
  };
}

export const FRAMES_PER_SECOND = 60;

export interface DrawTiming {
  readonly draw: number;
  readonly wallTimeMs: number;
  readonly callbackFrame: number;
  readonly callbacks: number;
}

export class RealtimeClients {
  private origin = 0;
  private ran = 0;
  private started = 0;
  private drawnAt = 0;
  private draws = 0;
  private readonly held = new Set<number>();

  constructor(
    readonly clients: Lockstep,
    private readonly inputs: ReadonlyMap<number, TypedInput>,
    private readonly now: () => number = () => performance.now(),

    private readonly afterFrame: (this: void) => void = () => undefined,

    private readonly afterDraw: (this: void, timing: DrawTiming) => void = () => undefined,
  ) {}

  start(): void {
    this.clients.start();
    this.origin = this.now();
    this.started = this.origin;
    this.drawnAt = this.origin;
    this.ran = 0;
    this.draws = 0;
    for (const client of this.clients.clients) client.setWallTime(0);
  }

  private deliver(): void {
    for (const [slot, input] of this.inputs) {
      if (this.held.has(slot)) continue;
      for (const text of input.read()) this.clients.type(slot, text);
    }
  }

  advance(): number {
    const frameMillis = 1000 / FRAMES_PER_SECOND;
    const now = this.now();
    for (const client of this.clients.clients) client.setWallTime((now - this.started) / 1000);
    if (this.held.size > 0) return frameMillis;
    const due = Math.floor(((now - this.origin) * FRAMES_PER_SECOND) / 1000);
    const before = this.ran;
    if (now > this.drawnAt) for (const client of this.clients.clients) client.draw((now - this.drawnAt) / 1000);
    while (this.ran < due) {
      this.deliver();
      this.clients.frames(1, { draw: false });
      this.ran++;
      this.afterFrame();
    }
    if (now > this.drawnAt) {
      this.drawnAt = now;
      this.afterDraw({ draw: ++this.draws, wallTimeMs: now - this.started, callbackFrame: this.clients.frame, callbacks: this.ran - before });
    }
    return this.origin + (this.ran + 1) * frameMillis - this.now();
  }

  frameDueMs(): number {
    return this.origin + ((this.ran + 1) * 1000) / FRAMES_PER_SECOND;
  }

  hold(slot: number): void {
    this.clients.client(slot);
    this.held.add(slot);
  }

  release(slot: number): void {
    if (!this.held.delete(slot) || this.held.size > 0) return;
    this.origin = this.now() - (this.ran * 1000) / FRAMES_PER_SECOND;
    this.drawnAt = this.now();
  }
}
