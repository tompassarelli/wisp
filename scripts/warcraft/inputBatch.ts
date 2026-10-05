/** Inputs between two observed screen boundaries. Waits are calibrated by the consuming journey. */
export type InputAction =
  | { readonly kind: "keys"; readonly keys: readonly string[]; readonly delayMillis?: number }
  | { readonly kind: "text"; readonly text: string; readonly delayMillis?: number }
  | { readonly kind: "click"; readonly x: number; readonly y: number; readonly settleMillis?: number; readonly holdMillis?: number }
  | { readonly kind: "wait"; readonly millis: number };

export interface PointerPosition { readonly x: number; readonly y: number }
export interface InputBatch {
  readonly args: readonly string[];
  /** Stop before pressing if relative XTEST motion did not reach this point. */
  readonly pointer?: PointerPosition;
}

/**
 * xdotool type consumes the rest of its argv, so it ends one command batch.
 * Arguments are passed directly to the process, never through a shell or its script expander.
 */
export function inputBatches(actions: readonly InputAction[], pointer: PointerPosition): readonly InputBatch[] {
  const commands: InputBatch[] = [];
  let current: string[] = [];
  let at = pointer;
  const wait = (millis: number) => { if (millis > 0) current.push("sleep", String(millis / 1000)); };
  for (const action of actions) {
    switch (action.kind) {
      case "keys":
        current.push("key", "--clearmodifiers", "--delay", String(action.delayMillis ?? 12), ...action.keys);
        break;
      case "text":
        current.push("type", "--clearmodifiers", "--delay", String(action.delayMillis ?? 12), "--", action.text);
        commands.push({ args: current });
        current = [];
        break;
      case "click":
        current.push("mousemove_relative", "--", String(action.x - at.x), String(action.y - at.y));
        current.push("getmouselocation", "--shell");
        at = { x: action.x, y: action.y };
        commands.push({ args: current, pointer: at });
        current = [];
        wait(action.settleMillis ?? 120);
        current.push("mousedown", "1");
        wait(action.holdMillis ?? 60);
        current.push("mouseup", "1");
        break;
      case "wait":
        wait(action.millis);
        break;
    }
  }
  if (current.length > 0) commands.push({ args: current });
  return commands;
}
