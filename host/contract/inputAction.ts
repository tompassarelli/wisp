export type InputAction =
  | { readonly kind: "keys"; readonly keys: readonly string[]; readonly delayMillis?: number; readonly settleMillis?: number; readonly holdMillis?: number }
  | { readonly kind: "text"; readonly text: string; readonly delayMillis?: number }
  | { readonly kind: "click"; readonly x: number; readonly y: number; readonly settleMillis?: number; readonly holdMillis?: number }
  | { readonly kind: "wait"; readonly millis: number };

export type KeyAction = Exclude<InputAction, { readonly kind: "click" }>;
