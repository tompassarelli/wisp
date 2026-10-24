export type InputAction =
  | { readonly kind: "keys"; readonly keys: readonly string[]; readonly delayMillis?: number; readonly settleMillis?: number; readonly holdMillis?: number }
  | { readonly kind: "text"; readonly text: string; readonly delayMillis?: number }
  | { readonly kind: "click"; readonly x: number; readonly y: number; readonly settleMillis?: number; readonly holdMillis?: number }
  | { readonly kind: "wait"; readonly millis: number };

const SENDING_KEYS = new Set(["return", "kp_enter", "iso_enter", "linefeed"]);
export const sendsChat = (names: readonly string[]) => names.some((name) => name.split("+").some((key) => SENDING_KEYS.has(key.toLowerCase())));

const VNC_KEYS: Readonly<Record<string, string>> = {
  return: "return", kp_enter: "kpenter", iso_enter: "return", linefeed: "return",
  escape: "esc", backspace: "bsp", insert: "ins", prior: "pgup", page_up: "pgup", next: "pgdn", page_down: "pgdn",
  control: "ctrl", control_l: "lctrl", control_r: "rctrl", shift_l: "lshift", shift_r: "rshift",
  alt_l: "lalt", alt_r: "ralt", super_l: "lsuper", super_r: "rsuper", meta_l: "lmeta", meta_r: "rmeta",
  caps_lock: "caplk", num_lock: "numlk", scroll_lock: "scrlk", print: "sysrq", backslash: "bslash", slash: "fslash",
  // vncdotool maps "slash" to BackSlash; "fslash" is the forward slash.
  "-": "minus", "/": "fslash", "\\": "bslash", " ": "space", "\n": "return", "\t": "tab",
};

export const vncKey = (name: string) => name.split("+").map((part) => VNC_KEYS[part.toLowerCase()] ?? VNC_KEYS[part] ?? (part.length === 1 ? part : part.toLowerCase())).join("-");

const SHIFTED = new Set([..."~!@#$%^&*()_+{}|:\"<>?ABCDEFGHIJKLMNOPQRSTUVWXYZ"]);
const PLAIN = new Set([..."abcdefghijklmnopqrstuvwxyz0123456789 `-=[]\\;',./\n\t"]);

export const untypable = (text: string) => [...text].find((character) => !SHIFTED.has(character) && !PLAIN.has(character));

const TEXT_DELAY_MILLIS = 80;

const pauseFor = (millis: number): readonly string[] => (millis > 0 ? ["pause", String(millis / 1000)] : []);

const keyActions = (action: Extract<InputAction, { kind: "keys" }>) => action.keys.flatMap((key): readonly string[] => {
  const name = vncKey(key);
  if (sendsChat([key])) return ["keydown", name, ...pauseFor(300), "keyup", name, ...pauseFor(action.settleMillis ?? 660)];
  if (action.holdMillis !== undefined) return ["keydown", name, ...pauseFor(action.holdMillis), "keyup", name];
  return ["key", name, ...pauseFor(action.delayMillis ?? 12)];
});

export function vncActions(actions: readonly InputAction[]): readonly string[] {
  const out: string[] = [];
  const pause = (millis: number) => { out.push(...pauseFor(millis)); };
  for (const action of actions) {
    switch (action.kind) {
      case "keys":
        out.push(...keyActions(action));
        break;
      case "text":
        for (const character of action.text) {
          const name = vncKey(character);
          out.push(...(SHIFTED.has(character) ? ["keydown", "shift", "key", name, "keyup", "shift"] : ["key", name]));
          pause(action.delayMillis ?? TEXT_DELAY_MILLIS);
        }
        break;
      case "click":
        out.push("move", String(action.x), String(action.y));
        pause(action.settleMillis ?? 120);
        out.push("mousedown", "1");
        pause(action.holdMillis ?? 60);
        out.push("mouseup", "1");
        break;
      case "wait":
        pause(action.millis);
        break;
    }
  }
  return out;
}
