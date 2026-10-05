// A journey: what players do in a headless match, frame by frame, as data a
// game declares once and runs in Bun or 32-bit Lua (wisp:docs/headless.md).
import type { Lockstep } from "./lockstep";

/** After `frame` frames have run: a player's chat line, a key press and release, or a hot reload of the map's bundle. */
export type JourneyEvent =
  | { readonly frame: number; readonly player: number; readonly chat: string }
  | { readonly frame: number; readonly player: number; readonly key: number; readonly meta: number }
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
  readonly checksum: string;
  readonly errors: readonly string[];
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

/** Starts the map in every client and plays the journey. */
export function runJourney(clients: Lockstep, journey: Journey): JourneyResult {
  clients.start();
  for (const event of journey.events) {
    if (event.frame < clients.frame) throw new Error(`journey event at frame ${event.frame} is out of order`);
    clients.frames(event.frame - clients.frame);
    if ("chat" in event) clients.chat(event.player, event.chat);
    else if ("key" in event) clients.press(event.player, event.key, event.meta);
    else clients.reload();
  }
  clients.frames(journey.frames - clients.frame);
  const results: ClientResult[] = [];
  for (const client of clients.clients) results.push({ slot: client.slot, calls: client.callCount(), checksum: client.checksum(), errors: client.errors });
  return { frames: clients.frame, clients: results, divergence: clients.firstDivergence(), reloaded: clients.version, reloads: clients.unappliedReloads() };
}

/** Problems a journey found: a desync, an error report or a reload that didn't run. */
export function journeyProblems(result: JourneyResult): number {
  let problems = (result.divergence === undefined ? 0 : 1) + result.reloads.length;
  for (const client of result.clients) problems += client.errors.length;
  return problems;
}

/** The result as lines to print: each client's calls and checksum, then each problem. */
export function journeyLines(result: JourneyResult): string[] {
  const lines: string[] = [];
  for (const client of result.clients) lines.push(`p${client.slot}: ${client.calls} native calls, checksum ${client.checksum}`);
  lines.push(result.divergence === undefined ? `no desync in ${result.frames} frames` : `desync: ${result.divergence}`);
  if (result.reloaded > 0 && result.reloads.length === 0) lines.push(`hot reload ${result.reloaded} running in every client`);
  for (const reload of result.reloads) lines.push(reload);
  for (const client of result.clients) for (const error of client.errors) lines.push(`p${client.slot}: ${error}`);
  return lines;
}
