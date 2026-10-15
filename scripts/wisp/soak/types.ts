export interface SoakController {
  readonly buttons: readonly string[];

  readonly weights?: readonly number[];

  readonly toggles?: readonly string[];
  readonly axes: readonly string[];
  readonly axisLimit: number;

  readonly deadZone: number;
}

export type SoakEdge =
  | { readonly button: number; readonly down: boolean }
  | { readonly axis: number; readonly value: number };

export interface SoakInputFrame {

  readonly edges: ReadonlyMap<number, readonly SoakEdge[]>;

  readonly silences: ReadonlyMap<number, number>;

  readonly hitchMs: number;

  readonly typed: ReadonlyMap<number, readonly string[]>;

  readonly files: ReadonlyMap<number, readonly (readonly [name: string, chunks: readonly string[]])[]>;
}

export interface SoakInputs {
  readonly edges: readonly (readonly [frame: number, slot: number, edge: SoakEdge])[];
  readonly silences: readonly (readonly [frame: number, slot: number, frames: number])[];
  readonly hitches: readonly (readonly [frame: number, ms: number])[];

  readonly slow: readonly (readonly [frame: number, ms: number])[];

  readonly typed?: readonly (readonly [frame: number, slot: number, text: string])[];
  readonly files?: readonly (readonly [frame: number, slot: number, name: string, chunks: readonly string[]])[];
}

export interface FuzzOptions {

  readonly rate: number;

  readonly silence: number;

  readonly hitch: number;
}


export interface SoakMatch {

  readonly index: number;
  readonly seed: number;

  readonly fighters: readonly string[];
  readonly stage: string;

  readonly policies: readonly string[];

  readonly frames: number;

  readonly typed?: boolean;
}
