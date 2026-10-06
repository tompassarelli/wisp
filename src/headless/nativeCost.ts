// Predicted native frame cost (wisp:docs/frame-cost.md#predicted-native-cost):
// what a frame a headless client measured would cost in Warcraft, from what
// it did. Warcraft's Lua runs slower than this host's 32-bit Lua, each call
// of a native or Blizzard.j function costs time beyond the Lua around it, the
// collector's work grows with what the frame allocated, and text typed into
// an edit box stops the game for a time that grows with the square of the
// characters taken at once. The Lua term counts instructions, so a prediction
// is the same on every run and every machine. Plain TypeScript, so Bun and Lua
// programs share it.
import { f32 } from "../sim/f32";

/** What one client's frame did, as a headless run measures it. */
export interface FrameWork {
  /** Lua instructions in the map's code. */
  readonly instructions: number;
  /** Calls of Warcraft's functions. */
  readonly natives: number;
  /** Kilobytes the map's code allocated. */
  readonly allocatedKb: number;
  /** Characters typed into the client's edit box before the frame. */
  readonly typedCharacters: number;
}

export interface NativeCostModel {
  /** The development host's 32-bit Lua microseconds per thousand instructions of map code. */
  readonly hostUsPerThousandInstructions: number;
  /** Warcraft's Lua time for one of the development host's 32-bit Lua microseconds. */
  readonly luaFactor: number;
  /** Microseconds per call of a native or Blizzard.j function, beyond the Lua around it. */
  readonly nativeCallUs: number;
  /** Collector microseconds per kilobyte allocated, in Warcraft. */
  readonly collectorUsPerKb: number;
  /** Microseconds the game stops per square of the characters an edit box takes in one frame. */
  readonly typingUsPerCharacterSquared: number;
}

/** A frame's predicted cost in Warcraft, in microseconds. */
export interface NativeFrameCost {
  /** The map's callbacks, collector included: what the frame meter's Lua time measures natively. */
  readonly callbacksUs: number;
  /** The game stopped taking typed text, outside the callbacks. */
  readonly typingUs: number;
}

export function nativeFrameCost(model: NativeCostModel, work: FrameWork): NativeFrameCost {
  const luaUs = model.luaFactor * model.hostUsPerThousandInstructions * work.instructions / 1000;
  return {
    callbacksUs: luaUs + model.nativeCallUs * work.natives + model.collectorUsPerKb * work.allocatedKb,
    typingUs: model.typingUsPerCharacterSquared * work.typedCharacters * work.typedCharacters,
  };
}

/**
 * Warcraft III as measured (wisp:docs/frame-cost.md#predicted-native-cost):
 * Warcraft's Lua 1.17 times slower than the development host's 32-bit Lua on
 * Smashcraft's 4096-frame workload; that host's instruction rate on
 * Smashcraft's four-fighter bot match; native calls and the collector fitted
 * to the 0.0.49 four-fighter overlay; typing 0.00003 frames per character
 * squared, from 608 characters holding a client 180 ms.
 */
export const WARCRAFT_COST: NativeCostModel = {
  hostUsPerThousandInstructions: f32(18.2),
  luaFactor: f32(1.17),
  nativeCallUs: 2,
  collectorUsPerKb: 2,
  typingUsPerCharacterSquared: 0.5,
};
