import type { Lockstep } from "./lockstep";
import type { MissingNative } from "./client";

export type JourneyEvent =
  | { readonly frame: number; readonly player: number; readonly chat: string }
  | { readonly frame: number; readonly player: number; readonly key: number; readonly meta: number; readonly down?: boolean }
  | { readonly frame: number; readonly reload: true };

export interface Journey {

  readonly frames: number;

  readonly events: readonly JourneyEvent[];
}

export interface ClientResult {
  readonly slot: number;
  readonly calls: number;

  readonly checksum?: string;
  readonly errors: readonly string[];
  readonly missingNatives: readonly MissingNative[];
}

export interface JourneyResult {
  readonly frames: number;
  readonly clients: readonly ClientResult[];

  readonly divergence: string | undefined;

  readonly reloaded: number;

  readonly reloads: readonly string[];
}

export interface JourneyOptions {

  readonly stepFrames?: number;

  readonly checksums?: boolean;

  readonly observationFrames?: readonly number[];

  readonly observe?: (this: void, clients: Lockstep, frame: number) => void;

  readonly observationClock?: (this: void, clients: Lockstep) => number | undefined;
}

export function runJourney(clients: Lockstep, journey: Journey, options: JourneyOptions = {}): JourneyResult {
  const clock = options.observationClock;
  const stepFrames = clock === undefined ? options.stepFrames ?? journey.frames + 1 : 1;
  if (!Number.isInteger(stepFrames) || stepFrames < 1) throw new Error("stepFrames must be a positive integer");
  clients.start();
  const frames = [...new Set(options.observationFrames ?? [])].sort((a, b) => a - b);
  for (const frame of frames) if (!Number.isInteger(frame) || frame < 0 || (clock === undefined && frame > journey.frames)) throw new Error(`observation frame ${frame} is outside the journey`);
  let observation = 0;
  const now = () => clock === undefined ? clients.frame : clock(clients);
  const capture = () => {
    const frame = now();
    if (frame === undefined || frames[observation] !== frame) return;
    options.observe?.(clients, frame);
    observation++;
  };
  const advance = (target: number) => {
    const stepTo = (frame: number) => {
      while (clients.frame < frame) {
        clients.frames(Math.min(stepFrames, frame - clients.frame));
        if (clock !== undefined && clients.frame < frame) capture();
      }
    };
    while (clock === undefined && (frames[observation] ?? target) < target) {
      const frame = frames[observation];
      if (frame === undefined) break;
      stepTo(frame);
      capture();
    }
    stepTo(target);
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

export function journeyProblems(result: JourneyResult): number {
  let problems = (result.divergence === undefined ? 0 : 1) + result.reloads.length;
  for (const client of result.clients) problems += client.errors.length + client.missingNatives.length;
  return problems;
}

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
