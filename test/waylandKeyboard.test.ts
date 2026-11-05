import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { openVirtualKeyboard, registryGlobal, waylandEvents, waylandRequest } from "../host/play/waylandKeyboard";

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
