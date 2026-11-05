import { dlopen, ptr } from "bun:ffi";
import { join } from "node:path";
import { Effect } from "effect";
import { DesktopFailure } from "../contract/client";
import { monotonicNs } from "../os/platform/linux/monotonic";
import type { Keyboard } from "./keyboard";

const EVDEV_KEYS: Readonly<Record<string, number>> = {
  ...Object.fromEntries([..."qwertyuiop"].map((key, index) => [key, 16 + index])),
  ...Object.fromEntries([..."asdfghjkl"].map((key, index) => [key, 30 + index])),
  ...Object.fromEntries([..."zxcvbnm"].map((key, index) => [key, 44 + index])),
  ...Object.fromEntries([..."1234567890"].map((key, index) => [key, 2 + index])),
  space: 57, Return: 28, Escape: 1, Tab: 15, BackSpace: 14, Left: 105, Up: 103, Right: 106, Down: 108,
};

const DISPLAY_ID = 1;
const REGISTRY_ID = 2;
const SYNC_ID = 3;
const SEAT_ID = 4;
const MANAGER_ID = 5;
const KEYBOARD_ID = 6;
const DISPLAY_SYNC = 0;
const DISPLAY_GET_REGISTRY = 1;
const DISPLAY_ERROR = 0;
const REGISTRY_BIND = 0;
const REGISTRY_GLOBAL = 0;
const CALLBACK_DONE = 0;
const MANAGER_CREATE = 0;
const KEYBOARD_KEYMAP = 0;
const KEYBOARD_KEY = 1;
const KEYMAP_XKB_V1 = 1;
const MANAGER_INTERFACE = "zwp_virtual_keyboard_manager_v1";
const SETUP_TIMEOUT_MS = 2000;

/** Evaluated by the compositor's own libxkbcommon, which resolves the includes and hands clients the compiled map. */
const KEYMAP = `xkb_keymap {
  xkb_keycodes { include "evdev+aliases(qwerty)" };
  xkb_types { include "complete" };
  xkb_compat { include "complete" };
  xkb_symbols { include "pc+us+inet(evdev)" };
};
`;

const padded = (length: number) => (length + 3) & ~3;

/** The evdev code of a key name: a lowercase letter, a digit, or one of the named keys the X path also takes. */
function evdevKeyOf(name: string): number | undefined {
  return Object.hasOwn(EVDEV_KEYS, name) ? EVDEV_KEYS[name] : undefined;
}

export type WireArgument = number | string;

/** One Wayland request: the object, then size and opcode in one word, then each argument as a word or a length-prefixed, NUL-ended, word-padded string. */
export function waylandRequest(object: number, opcode: number, args: readonly WireArgument[]): Uint8Array {
  const encoded = args.map((arg) => typeof arg === "number" ? 4 : 4 + padded(new TextEncoder().encode(arg).length + 1));
  const bytes = new Uint8Array(8 + encoded.reduce((sum, size) => sum + size, 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, object, true);
  view.setUint32(4, (bytes.length << 16) | opcode, true);
  let offset = 8;
  args.forEach((arg, index) => {
    if (typeof arg === "number") view.setUint32(offset, arg, true);
    else {
      const text = new TextEncoder().encode(arg);
      view.setUint32(offset, text.length + 1, true);
      bytes.set(text, offset + 4);
    }
    offset += encoded[index]!;
  });
  return bytes;
}

export interface WaylandEvent {
  readonly object: number;
  readonly opcode: number;
  readonly body: Uint8Array;
}

/** The whole events at the front of `bytes`, and how many bytes they used; a partial event waits for the rest. */
export function waylandEvents(bytes: Uint8Array): { readonly events: WaylandEvent[]; readonly used: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const events: WaylandEvent[] = [];
  let used = 0;
  while (used + 8 <= bytes.length) {
    const word = view.getUint32(used + 4, true);
    const size = word >>> 16;
    if (size < 8 || used + size > bytes.length) break;
    events.push({ object: view.getUint32(used, true), opcode: word & 0xffff, body: bytes.slice(used + 8, used + size) });
    used += size;
  }
  return { events, used };
}

function wireString(body: Uint8Array, offset: number): { readonly text: string; readonly next: number } {
  const length = new DataView(body.buffer, body.byteOffset).getUint32(offset, true);
  return { text: new TextDecoder().decode(body.subarray(offset + 4, offset + 4 + Math.max(0, length - 1))), next: offset + 4 + padded(length) };
}

/** A `wl_registry.global` event's name, interface and version. */
export function registryGlobal(body: Uint8Array): { readonly name: number; readonly interface: string; readonly version: number } {
  const view = new DataView(body.buffer, body.byteOffset, body.length);
  const { text, next } = wireString(body, 4);
  return { name: view.getUint32(0, true), interface: text, version: view.getUint32(next, true) };
}

const AF_UNIX = 1;
const SOCK_STREAM_CLOEXEC = 1 | 0o2000000;
const MSG_DONTWAIT = 0x40;
const MSG_NOSIGNAL = 0x4000;
const SOL_SOCKET = 1;
const SCM_RIGHTS = 1;
const MFD_CLOEXEC = 1;

let libc: ReturnType<typeof openLibc> | undefined;
function openLibc() {
  return dlopen("libc.so.6", {
    socket: { args: ["i32", "i32", "i32"], returns: "i32" },
    connect: { args: ["i32", "ptr", "u32"], returns: "i32" },
    send: { args: ["i32", "ptr", "u64", "i32"], returns: "i64" },
    sendmsg: { args: ["i32", "ptr", "i32"], returns: "i64" },
    recv: { args: ["i32", "ptr", "u64", "i32"], returns: "i64" },
    close: { args: ["i32"], returns: "i32" },
    memfd_create: { args: ["ptr", "u32"], returns: "i32" },
    write: { args: ["i32", "ptr", "u64"], returns: "i64" },
  }).symbols;
}
const c = () => (libc ??= openLibc());

const cString = (text: string) => new TextEncoder().encode(`${text}\0`);

function unixAddress(path: string): Uint8Array {
  const address = new Uint8Array(110);
  new DataView(address.buffer).setUint16(0, AF_UNIX, true);
  address.set(new TextEncoder().encode(path), 2);
  return address;
}

/** A Wayland connection on a raw socket, because a request that carries a file descriptor needs `sendmsg`, which Bun's sockets do not expose. */
class WaylandSocket {
  private queued = new Uint8Array(0);

  private constructor(readonly fd: number) {}

  static open(path: string): WaylandSocket | string {
    if (path.length > 107) return `${path} is longer than a unix socket path`;
    const fd = Number(c().socket(AF_UNIX, SOCK_STREAM_CLOEXEC, 0));
    if (fd < 0) return "socket() failed";
    const address = unixAddress(path);
    if (Number(c().connect(fd, ptr(address), address.length)) !== 0) {
      c().close(fd);
      return `nothing listens on ${path}`;
    }
    return new WaylandSocket(fd);
  }

  send(bytes: Uint8Array) {
    return Number(c().send(this.fd, ptr(bytes), bytes.length, MSG_NOSIGNAL)) === bytes.length;
  }

  sendWithFd(bytes: Uint8Array, passed: number) {
    const iov = new BigUint64Array([BigInt(ptr(bytes)), BigInt(bytes.length)]);
    const control = new Uint8Array(24);
    const controlView = new DataView(control.buffer);
    controlView.setBigUint64(0, 20n, true);
    controlView.setInt32(8, SOL_SOCKET, true);
    controlView.setInt32(12, SCM_RIGHTS, true);
    controlView.setInt32(16, passed, true);
    const header = new BigUint64Array([0n, 0n, BigInt(ptr(iov)), 1n, BigInt(ptr(control)), BigInt(control.length), 0n]);
    return Number(c().sendmsg(this.fd, ptr(header), MSG_NOSIGNAL)) === bytes.length;
  }

  /** The events that have arrived so far, without blocking. */
  poll(): WaylandEvent[] {
    const chunk = new Uint8Array(4096);
    for (;;) {
      const read = Number(c().recv(this.fd, ptr(chunk), chunk.length, MSG_DONTWAIT));
      if (read <= 0) break;
      const next = new Uint8Array(this.queued.length + read);
      next.set(this.queued);
      next.set(chunk.subarray(0, read), this.queued.length);
      this.queued = next;
    }
    const { events, used } = waylandEvents(this.queued);
    this.queued = this.queued.slice(used);
    return events;
  }

  close() {
    c().close(this.fd);
  }
}

function keymapFd(): number | string {
  const fd = Number(c().memfd_create(ptr(cString("wisp-keymap")), MFD_CLOEXEC));
  if (fd < 0) return "memfd_create() failed";
  const text = cString(KEYMAP);
  if (Number(c().write(fd, ptr(text), text.length)) !== text.length) {
    c().close(fd);
    return "could not write the keymap";
  }
  return fd;
}

/** The compositor's socket: an absolute WAYLAND_DISPLAY, or a name under XDG_RUNTIME_DIR. */
export const waylandSocketPath = (runtime: string, display: string) => display.startsWith("/") ? display : join(runtime, display);

const roundTrip = (socket: WaylandSocket, path: string, onEvent: (event: WaylandEvent) => void) => Effect.gen(function*() {
  const fail = (cause: string) => new DesktopFailure({ operation: "open the virtual keyboard", client: path, cause });
  if (!socket.send(waylandRequest(DISPLAY_ID, DISPLAY_SYNC, [SYNC_ID]))) return yield* fail("the compositor closed the connection");
  const deadline = monotonicNs() + SETUP_TIMEOUT_MS * 1e6;
  for (;;) {
    for (const event of socket.poll()) {
      if (event.object === DISPLAY_ID && event.opcode === DISPLAY_ERROR) return yield* fail(`protocol error ${new DataView(event.body.buffer).getUint32(4, true)}: ${wireString(event.body, 8).text}`);
      if (event.object === SYNC_ID && event.opcode === CALLBACK_DONE) return;
      onEvent(event);
    }
    if (monotonicNs() > deadline) return yield* fail(`no answer within ${SETUP_TIMEOUT_MS} ms`);
    yield* Effect.sleep(1);
  }
});

const connectVirtualKeyboard = (path: string, keyName: string) => {
  const fail = (cause: string) => new DesktopFailure({ operation: "open the virtual keyboard", client: path, cause });
  return Effect.acquireRelease(Effect.gen(function*() {
    const key = evdevKeyOf(keyName);
    if (key === undefined) return yield* fail(`${keyName} is not a lowercase letter, a digit or a named key`);
    const opened = WaylandSocket.open(path);
    if (typeof opened === "string") return yield* fail(opened);
    const socket = opened;
    return yield* Effect.gen(function*() {
      socket.send(waylandRequest(DISPLAY_ID, DISPLAY_GET_REGISTRY, [REGISTRY_ID]));
      const globals = new Map<string, { readonly name: number; readonly version: number }>();
      yield* roundTrip(socket, path, (event) => {
        if (event.object !== REGISTRY_ID || event.opcode !== REGISTRY_GLOBAL) return;
        const global = registryGlobal(event.body);
        if (!globals.has(global.interface)) globals.set(global.interface, global);
      });
      const seat = globals.get("wl_seat");
      const manager = globals.get(MANAGER_INTERFACE);
      if (seat === undefined) return yield* fail("the compositor offers no wl_seat");
      if (manager === undefined) return yield* fail(`the compositor offers no ${MANAGER_INTERFACE}`);
      socket.send(waylandRequest(REGISTRY_ID, REGISTRY_BIND, [seat.name, "wl_seat", 1, SEAT_ID]));
      socket.send(waylandRequest(REGISTRY_ID, REGISTRY_BIND, [manager.name, MANAGER_INTERFACE, 1, MANAGER_ID]));
      socket.send(waylandRequest(MANAGER_ID, MANAGER_CREATE, [SEAT_ID, KEYBOARD_ID]));
      const keymap = keymapFd();
      if (typeof keymap === "string") return yield* fail(keymap);
      const sent = socket.sendWithFd(waylandRequest(KEYBOARD_ID, KEYBOARD_KEYMAP, [KEYMAP_XKB_V1, cString(KEYMAP).length]), keymap);
      c().close(keymap);
      if (!sent) return yield* fail("could not send the keymap");
      yield* roundTrip(socket, path, () => {});
      return { socket, key };
    }).pipe(Effect.onError(() => Effect.sync(() => socket.close())));
  }), ({ socket }) => Effect.sync(() => socket.close()));
};

/**
 * Opens a `zwp_virtual_keyboard_v1` on the compositor at `path` and presses `keyName` through it in-process, so a native Wayland window
 * takes the press the way it takes a real key: the compositor routes it through its own keyboard handling to the focused surface.
 * The compositor must offer the protocol to every client, as the private desktop's labwc does (wayvnc types through it too).
 */
export const openVirtualKeyboard = (path: string, keyName: string) => connectVirtualKeyboard(path, keyName).pipe(
  Effect.map(({ socket, key }): Keyboard => ({
    send: (down) => {
      const beforeNs = monotonicNs();
      socket.send(waylandRequest(KEYBOARD_ID, KEYBOARD_KEY, [Math.floor(beforeNs / 1e6) >>> 0, key, down ? 1 : 0]));
      return { beforeNs, afterNs: monotonicNs() };
    },
  })),
);
