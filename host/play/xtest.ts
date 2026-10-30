import { connect } from "node:net";
import { Effect } from "effect";
import { DesktopFailure } from "../os/warcraft/desktopClient";

const NAMED_KEYSYMS: Readonly<Record<string, number>> = {
  space: 0x20, Return: 0xff0d, Escape: 0xff1b, Tab: 0xff09, BackSpace: 0xff08,
  Left: 0xff51, Up: 0xff52, Right: 0xff53, Down: 0xff54,
};

const QUERY_EXTENSION = 98;
const GET_KEYBOARD_MAPPING = 101;
const KEY_PRESS = 2;
const KEY_RELEASE = 3;
const FAKE_INPUT = 2;
const SETUP_MIN_KEYCODE = 26;
const SETUP_MAX_KEYCODE = 27;

const nowNs = () => Number(process.hrtime.bigint());
const padded = (length: number) => (length + 3) & ~3;

/** The X keysym for a key name: one Latin-1 character, a named key, or `0x` hex. */
export function keysymOf(name: string): number | undefined {
  if (name.length === 1) return name.charCodeAt(0);
  if (/^0x[0-9a-f]+$/i.test(name)) return Number(name);
  return NAMED_KEYSYMS[name];
}

/** The X display's unix socket path: `:4` and `:4.0` both name `/tmp/.X11-unix/X4`. */
export function displaySocket(display: string): string | undefined {
  const number = /^:(\d+)(?:\.\d+)?$/.exec(display)?.[1];
  return number === undefined ? undefined : `/tmp/.X11-unix/X${number}`;
}

const connectionSetup = () => Uint8Array.of(0x6c, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0);

export function queryExtension(name: string): Uint8Array {
  const bytes = new Uint8Array(8 + padded(name.length));
  const view = new DataView(bytes.buffer);
  bytes[0] = QUERY_EXTENSION;
  view.setUint16(2, bytes.length / 4, true);
  view.setUint16(4, name.length, true);
  bytes.set(new TextEncoder().encode(name), 8);
  return bytes;
}

function getKeyboardMapping(first: number, count: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setUint16(2, 2, true);
  bytes[0] = GET_KEYBOARD_MAPPING;
  bytes[4] = first;
  bytes[5] = count;
  return bytes;
}

/** The XTEST FakeInput request that presses or releases `keycode`. */
export function fakeKey(extensionOpcode: number, keycode: number, down: boolean): Uint8Array {
  const bytes = new Uint8Array(36);
  new DataView(bytes.buffer).setUint16(2, 9, true);
  bytes[0] = extensionOpcode;
  bytes[1] = FAKE_INPUT;
  bytes[4] = down ? KEY_PRESS : KEY_RELEASE;
  bytes[5] = keycode;
  return bytes;
}

/** The lowest keycode whose unshifted keysym is `keysym`, from a GetKeyboardMapping reply body. */
export function keycodeOf(keysym: number, firstKeycode: number, keysymsPerKeycode: number, keysyms: Uint32Array): number | undefined {
  for (let index = 0; index * keysymsPerKeycode < keysyms.length; index++) {
    if (keysyms[index * keysymsPerKeycode] === keysym) return firstKeycode + index;
  }
  return undefined;
}

/** A byte stream that hands out exact byte counts as they arrive. */
class Reader {
  private queued: Uint8Array = new Uint8Array(0);
  private waiting: { readonly length: number; readonly resolve: (bytes: Uint8Array) => void } | undefined;

  push(chunk: Uint8Array) {
    const next = new Uint8Array(this.queued.length + chunk.length);
    next.set(this.queued);
    next.set(chunk, this.queued.length);
    this.queued = next;
    this.settle();
  }

  take(length: number) {
    return Effect.callback<Uint8Array>((resume) => {
      this.waiting = { length, resolve: (bytes) => resume(Effect.succeed(bytes)) };
      this.settle();
    });
  }

  private settle() {
    if (this.waiting === undefined || this.queued.length < this.waiting.length) return;
    const { length, resolve } = this.waiting;
    this.waiting = undefined;
    resolve(this.queued.slice(0, length));
    this.queued = this.queued.slice(length);
  }
}

export interface Keyboard {
  /** Presses or releases the key, returning the monotonic nanoseconds just before and after the request left for the X server. */
  readonly send: (down: boolean) => { readonly beforeNs: number; readonly afterNs: number };
}

const connectKeyboard = (display: string, keyName: string) => {
  const fail = (cause: string) => new DesktopFailure({ operation: "open the keyboard", client: display, cause });
  return Effect.acquireRelease(Effect.gen(function*() {
    const path = displaySocket(display);
    const keysym = keysymOf(keyName);
    if (path === undefined) return yield* fail(`${display} is not an X display such as :4`);
    if (keysym === undefined) return yield* fail(`${keyName} is not a single character, a named key or 0x hex`);
    const reader = new Reader();
    const socket = connect(path);
    socket.on("data", (chunk: Buffer) => reader.push(chunk));
    yield* Effect.callback<void, DesktopFailure>((resume) => {
      socket.once("connect", () => resume(Effect.void));
      socket.once("error", (cause) => resume(Effect.fail(fail(cause.message))));
    }).pipe(Effect.onError(() => Effect.sync(() => socket.destroy())));
    return yield* Effect.gen(function*() {
      socket.write(connectionSetup());
      const head = yield* reader.take(8);
      const setup = yield* reader.take(new DataView(head.buffer).getUint16(6, true) * 4);
      if (head[0] !== 1) return yield* fail(`${path} refused the connection: ${new TextDecoder().decode(setup.subarray(0, head[1]))}`);
      const minKeycode = setup[SETUP_MIN_KEYCODE]!;
      const maxKeycode = setup[SETUP_MAX_KEYCODE]!;
      socket.write(queryExtension("XTEST"));
      const extension = yield* reader.take(32);
      if (extension[8] !== 1) return yield* fail(`${path} has no XTEST extension`);
      const opcode = extension[9]!;
      socket.write(getKeyboardMapping(minKeycode, maxKeycode - minKeycode + 1));
      const mapping = yield* reader.take(32);
      const body = yield* reader.take(new DataView(mapping.buffer).getUint32(4, true) * 4);
      const keycode = keycodeOf(keysym, minKeycode, mapping[1]!, new Uint32Array(body.buffer, body.byteOffset, body.length / 4));
      if (keycode === undefined) return yield* fail(`no key on ${path} types ${keyName} unshifted`);
      return { socket, keycode, opcode };
    }).pipe(Effect.onError(() => Effect.sync(() => socket.destroy())));
  }), ({ socket }) => Effect.sync(() => socket.destroy()));
};

/**
 * Opens a connection to the X server on `display` and presses `keyName` through XTEST in-process,
 * so the press lands at a known monotonic time: a spawned `xdotool` takes 15 ms to start and exit,
 * a whole display frame of doubt about when the key went down.
 * The server must accept connections without credentials, as the private desktop's Xwayland does.
 */
export const openKeyboard = (display: string, keyName: string) => connectKeyboard(display, keyName).pipe(
  Effect.map(({ socket, keycode, opcode }): Keyboard => ({
    send: (down) => {
      const beforeNs = nowNs();
      socket.write(fakeKey(opcode, keycode, down));
      return { beforeNs, afterNs: nowNs() };
    },
  })),
);
