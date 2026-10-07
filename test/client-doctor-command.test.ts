import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { clientsDoctor, doctorTargets } from "../scripts/wisp/clientDoctorCommand";
import { ClientWatch, type ClientState } from "../scripts/wisp/watch";

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-offline-doctor-"));
  const run = join(root, "desktop");
  mkdirSync(run);
  for (const [name, value] of Object.entries({ display: ":4", xauthority: "", "wayland-display": "wayland-4" })) writeFileSync(join(run, name), value);
  const path = join(root, "clients.json");
  const client = (name: string, offline?: boolean) => ({ name, run, documents: `${root}/${name}/pfx/drive_c/users/steamuser/Documents/Warcraft III`, ...(offline === undefined ? {} : { offline }) });
  const write = (clients: ReturnType<typeof client>[]) => writeFileSync(path, JSON.stringify({ tools: { grim: "unused", xdotool: "unused", wlrctl: "unused", tesseract: "unused" }, clients }));
  return { client, write, declaration: { clientsFile: path, start: {} }, close: () => rmSync(root, { recursive: true, force: true }) };
};

const watch = (state: ClientState) => ClientWatch.of({ view: client => Effect.succeed({ client: client.name, state, source: "socket", evidence: "offline regression", at: 0, scan: "done", loadErrors: { count: 0 } }) });

test("offline pool clients need no Battle.net declaration and their health runs no launcher or desktop tools", async () => {
  const file = fixture();
  try {
    file.write([file.client("a", true), file.client("b", true)]);
    const targets = await Effect.runPromise(doctorTargets(file.declaration));
    expect(targets.map(target => target.start.kind)).toEqual(["offline-pool", "offline-pool"]);
    const result = await Effect.runPromise(clientsDoctor(file.declaration, [], () => {}).pipe(Effect.provideService(ClientWatch, watch({ kind: "in match" }))));
    expect(result).toEqual([{ client: "a", state: "in match", recovered: [] }, { client: "b", state: "in match", recovered: [] }]);
  } finally { file.close(); }
});

test("a closed or crashed offline client stops for its pool owner instead of trying Battle.net recovery", async () => {
  const file = fixture();
  try {
    file.write([file.client("lan0a", true)]);
    for (const state of [{ kind: "closed" }, { kind: "crashed", reason: "Crash.txt" }, { kind: "disconnected", reason: "connection lost" }] satisfies ClientState[]) {
      const result = await Effect.runPromise(clientsDoctor(file.declaration, [], () => {}).pipe(Effect.provideService(ClientWatch, watch(state)), Effect.result));
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure.message).toBe(`lan0a: ${state.kind}; restart its offline pool pair before retrying`);
    }
  } finally { file.close(); }
});

test("signed-in clients still require a Battle.net declaration, including a mixed offline and signed-in file", async () => {
  const file = fixture();
  try {
    for (const offline of [undefined, false]) {
      file.write([file.client("a", true), file.client("b", offline)]);
      const result = await Effect.runPromise(doctorTargets(file.declaration).pipe(Effect.result));
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure.message).toBe("b: the game declares no way to start its Battle.net");
      expect((await Effect.runPromise(doctorTargets(file.declaration, ["a"]))).map(target => target.start.kind)).toEqual(["offline-pool"]);
    }
  } finally { file.close(); }
});
