import { f32 } from "../sim/f32";

export interface FrameWork {

  readonly instructions: number;

  readonly natives: number;

  readonly allocatedKb: number;

  readonly typedCharacters: number;
}

export interface NativeCostModel {

  readonly hostUsPerThousandInstructions: number;

  readonly luaFactor: number;

  readonly nativeCallUs: number;

  readonly collectorUsPerKb: number;

  readonly typingUsPerCharacterSquared: number;
}

export interface NativeFrameCost {

  readonly callbacksUs: number;

  readonly typingUs: number;
}

export function nativeFrameCost(model: NativeCostModel, work: FrameWork): NativeFrameCost {
  const luaUs = model.luaFactor * model.hostUsPerThousandInstructions * work.instructions / 1000;
  return {
    callbacksUs: luaUs + model.nativeCallUs * work.natives + model.collectorUsPerKb * work.allocatedKb,
    typingUs: model.typingUsPerCharacterSquared * work.typedCharacters * work.typedCharacters,
  };
}

// Model coefficients use the native measurements in wisp:docs/frame-cost.md#predicted-native-cost.

export const WARCRAFT_COST: NativeCostModel = {
  hostUsPerThousandInstructions: f32(18.2),
  luaFactor: f32(1.17),
  nativeCallUs: 2,
  collectorUsPerKb: 2,
  typingUsPerCharacterSquared: 0.5,
};
