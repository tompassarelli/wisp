import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { pressLatencyArguments } from "../host/play/pressLatency";
import { evdevKeyOf, openVirtualKeyboard, registryGlobal, waylandEvents, waylandRequest, waylandSocketPath } from "../host/play/waylandKeyboard";

const words = (bytes: Uint8Array) => [...new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)];

const globalEvent = (name: number, iface: string, version: number) => waylandRequest(2, 0, [name, iface, version]);

/** A compositor that answers the registry and every sync, and records each request after them. */
function fakeCompositor(globals: readonly (readonly [number, string, number])[]) {
  const directory = mkdtempSync(join(tmpdir(), "wisp-wayland-"));
  const path = join(directory, "wayland-0");
  const requests: { object: number; opcode: number; body: Uint8Array }[] = [];
  let queued = new Uint8Array(0);
  const server = Bun.listen<undefined>({
    unix: path,
    socket: {
      data(socket, chunk) {
        const next = new Uint8Array(queued.length + chunk.length);
        next.set(queued);
        next.set(chunk, queued.length);
        const { events, used } = waylandEvents(next);
        queued = next.slice(used);
        for (const request of events) {
          requests.push(request);
          if (request.object === 1 && request.opcode === 1) for (const global of globals) socket.write(globalEvent(...global));
          if (request.object === 1 && request.opcode === 0) socket.write(waylandRequest(words(request.body)[0]!, 0, [0]));
        }
      },
    },
  });
  return { path, requests, stop: () => { server.stop(true); rmSync(directory, { recursive: true, force: true }); } };
}

test("[spec docs/online-plan.md] a Wayland request is its object, size and opcode, then words and NUL-ended padded strings", () => {
  expect(words(waylandRequest(2, 0, [7, "wl_seat", 1, 4]))).toEqual([2, 32 << 16, 7, 8, ...words(new TextEncoder().encode("wl_seat\0")), 1, 4]);
  expect(registryGlobal(globalEvent(9, "zwp_virtual_keyboard_manager_v1", 1).subarray(8))).toEqual({ name: 9, interface: "zwp_virtual_keyboard_manager_v1", version: 1 });
  const two = new Uint8Array([...waylandRequest(1, 0, [3]), ...waylandRequest(3, 0, [5]).subarray(0, 6)]);
  expect(waylandEvents(two)).toMatchObject({ events: [{ object: 1, opcode: 0 }], used: 12 });
  expect([evdevKeyOf("n"), evdevKeyOf("j"), evdevKeyOf("a"), evdevKeyOf("1"), evdevKeyOf("space"), evdevKeyOf("N"), evdevKeyOf("toString")]).toEqual([49, 36, 30, 2, 57, undefined, undefined]);
  expect(waylandSocketPath("/run/r", "wayland-0")).toBe("/run/r/wayland-0");
});

test("[spec docs/online-plan.md] the virtual keyboard binds the seat and manager, sends a keymap, and presses the key as an evdev code", async () => {
  const compositor = fakeCompositor([[1, "wl_compositor", 6], [3, "wl_seat", 9], [7, "zwp_virtual_keyboard_manager_v1", 1]]);
  try {
    const sent = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const keyboard = yield* openVirtualKeyboard(compositor.path, "n");
      const down = keyboard.send(true);
      keyboard.send(false);
      yield* Effect.sleep(50);
      return down;
    })));
    expect(sent.afterNs).toBeGreaterThanOrEqual(sent.beforeNs);
    const after = compositor.requests.slice(2);
    expect(after.map(({ object, opcode }) => [object, opcode])).toEqual([[2, 0], [2, 0], [5, 0], [6, 0], [1, 0], [6, 1], [6, 1]]);
    expect(registryGlobal(after[0]!.body)).toMatchObject({ name: 3, interface: "wl_seat" });
    expect(registryGlobal(after[1]!.body)).toMatchObject({ name: 7, interface: "zwp_virtual_keyboard_manager_v1" });
    expect(words(after[2]!.body)).toEqual([4, 6]);
    expect(words(after[3]!.body)[0]).toBe(1);
    expect(words(after[5]!.body).slice(1)).toEqual([49, 1]);
    expect(words(after[6]!.body).slice(1)).toEqual([49, 0]);
  } finally {
    compositor.stop();
  }
});

test("[spec docs/online-plan.md] a compositor without the virtual keyboard protocol fails the open by name", async () => {
  const compositor = fakeCompositor([[3, "wl_seat", 9]]);
  try {
    const exit = await Effect.runPromiseExit(Effect.scoped(openVirtualKeyboard(compositor.path, "n")));
    expect(Exit.isFailure(exit) && String(exit.cause)).toContain("zwp_virtual_keyboard_manager_v1");
  } finally {
    compositor.stop();
  }
});

test("[spec docs/online-plan.md] --input wayland needs no X display and names the compositor socket", () => {
  const args = ["--window", "native", "--input", "wayland", "--wayland-runtime", "/run/x", "--key", "n", "--region", "1,2,3,4", "--flash", "--out", "/tmp/o"];
  expect(pressLatencyArguments(args, {})).toMatchObject({ input: "wayland", display: undefined, waylandDisplay: "wayland-0" });
  expect(pressLatencyArguments([...args, "--wayland-display", "wayland-1"], {})).toMatchObject({ waylandDisplay: "wayland-1" });
  expect(typeof pressLatencyArguments(args.filter((arg) => arg !== "--input" && arg !== "wayland"), {})).toBe("string");
  expect(typeof pressLatencyArguments(args.map((arg) => (arg === "wayland" ? "uinput" : arg)), {})).toBe("string");
});
