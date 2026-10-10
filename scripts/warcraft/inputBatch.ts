export type InputAction =
  | { readonly kind: "keys"; readonly keys: readonly string[]; readonly delayMillis?: number; readonly settleMillis?: number }
  | { readonly kind: "text"; readonly text: string; readonly delayMillis?: number }
  | { readonly kind: "click"; readonly x: number; readonly y: number; readonly settleMillis?: number; readonly holdMillis?: number }
  | { readonly kind: "wait"; readonly millis: number };

export interface PointerPosition { readonly x: number; readonly y: number }
export interface InputBatch {
  readonly args: readonly string[];

  readonly pointer?: PointerPosition;
}

const SENDING_KEYS = new Set(["return", "kp_enter", "iso_enter", "linefeed"]);
export const sendsChat = (names: readonly string[]) => names.some((name) => name.split("+").some((key) => SENDING_KEYS.has(key.toLowerCase())));

export function inputBatches(actions: readonly InputAction[], pointer: PointerPosition): readonly InputBatch[] {
  const commands: InputBatch[] = [];
  let current: string[] = [];
  let at = pointer;
  const wait = (millis: number) => { if (millis > 0) current.push("sleep", String(millis / 1000)); };
  for (const action of actions) {
    switch (action.kind) {
      case "keys":
        for (const key of action.keys) {
          if (sendsChat([key])) {

            current.push("keydown", "--clearmodifiers", key);
            wait(300);
            current.push("keyup", "--clearmodifiers", key);

            wait(action.settleMillis ?? 660);
          } else current.push("key", "--clearmodifiers", "--delay", String(action.delayMillis ?? 12), key);
        }
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
