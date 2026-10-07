// A journey: what players do in a headless match, frame by frame, as data a
// game declares once and runs in Bun or 32-bit Lua (wisp:docs/headless.md).
import type { Lockstep } from "./lockstep";
import type { MissingNative } from "./client";

/** After `frame` frames have run: a player's chat line, a key event, or a hot reload of the map's bundle. */
export type JourneyEvent =
  | { readonly frame: number; readonly player: number; readonly chat: string }
  | { readonly frame: number; readonly player: number; readonly key: number; readonly meta: number; readonly down?: boolean }
  | { readonly frame: number; readonly reload: true };

export interface Journey {
  /** Frames the match runs after start. */
  readonly frames: number;
  /** In frame order. */
  readonly events: readonly JourneyEvent[];
}

export interface ClientResult {
  readonly slot: number;
  readonly calls: number;
  /** A hash of every logged call; left out when the run asked for none. */
  readonly checksum?: string;
  readonly errors: readonly string[];
  readonly missingNatives: readonly MissingNative[];
}

export interface JourneyResult {
  readonly frames: number;
  readonly clients: readonly ClientResult[];
  /** Where the first two clients' native calls part, if they do. */
  readonly divergence: string | undefined;
  /** Hot reload versions published. */
  readonly reloaded: number;
  /** Clients not running the last hot reload at the end. */
  readonly reloads: readonly string[];
}

export interface JourneyOptions {
  /** Whether to hash each client's calls, which fingerprints a run to compare it with another runtime's. */
  readonly checksums?: boolean;
  /** Frames observed after all journey events at that frame, including frame zero after start. */
  readonly observationFrames?: readonly number[];
  /** Reads each chosen frame without advancing gameplay. */
  readonly observe?: (this: void, clients: Lockstep, frame: number) => void;
}

/** Starts the map in every client and plays the journey. */
export function runJourney(clients: Lockstep, journey: Journey, options: JourneyOptions = {}): JourneyResult {
  clients.start();
  const frames = [...new Set(options.observationFrames ?? [])].sort((a, b) => a - b);
  for (const frame of frames) if (!Number.isInteger(frame) || frame < 0 || frame > journey.frames) throw new Error(`observation frame ${frame} is outside the journey`);
  let observation = 0;
  const capture = () => {
    if (frames[observation] !== clients.frame) return;
    options.observe?.(clients, clients.frame);
    observation++;
  };
  const advance = (target: number) => {
    while ((frames[observation] ?? target) < target) {
      const frame = frames[observation];
      if (frame === undefined) break;
      clients.frames(frame - clients.frame);
      capture();
    }
    clients.frames(target - clients.frame);
  };
  for (const event of journey.events) {
    if (event.frame < clients.frame) throw new Error(`journey event at frame ${event.frame} is out of order`);
    if (event.frame > clients.frame) capture();
    advance(event.frame);
    if ("chat" in event) clients.chat(event.player, event.chat);
    else if ("key" in event) {
      if (event.down === undefined) clients.press(event.player, event.key, event.meta);
      else clients.key(event.player, event.key, event.meta, event.down);
    }
    else clients.reload();
  }
  capture();
  advance(journey.frames);
  capture();
  const results: ClientResult[] = [];
  for (const client of clients.clients) {
    results.push(options.checksums === false
      ? { slot: client.slot, calls: client.callCount(), errors: client.errors, missingNatives: client.missingNatives }
      : { slot: client.slot, calls: client.callCount(), checksum: client.checksum(), errors: client.errors, missingNatives: client.missingNatives });
  }
  return { frames: clients.frame, clients: results, divergence: clients.firstDivergence(), reloaded: clients.version, reloads: clients.unappliedReloads() };
}

/** Problems a journey found: a desync, an error report or a reload that didn't run. */
export function journeyProblems(result: JourneyResult): number {
  let problems = (result.divergence === undefined ? 0 : 1) + result.reloads.length;
  for (const client of result.clients) problems += client.errors.length + client.missingNatives.length;
  return problems;
}

/** The result as lines to print: each client's calls and checksum, then each problem. */
export function journeyLines(result: JourneyResult): string[] {
  const lines: string[] = [];
  for (const client of result.clients) {
    lines.push(`p${client.slot}: ${client.calls} native calls${client.checksum === undefined ? "" : `, checksum ${client.checksum}`}`);
  }
  lines.push(result.divergence === undefined ? `no desync in ${result.frames} frames` : `desync: ${result.divergence}`);
  if (result.reloaded > 0 && result.reloads.length === 0) lines.push(`hot reload ${result.reloaded} running in every client`);
  for (const reload of result.reloads) lines.push(reload);
  for (const client of result.clients) for (const error of client.errors) lines.push(`p${client.slot}: ${error}`);
  for (const client of result.clients) for (const missing of client.missingNatives) lines.push(`p${missing.client} frame ${missing.frame}: unmodeled native ${missing.native}`);
  return lines;
}
