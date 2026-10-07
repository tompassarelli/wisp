import { expect, test } from "bun:test";
import { startPairClients } from "../scripts/wisp/lan/startup";

test("a peer starts only after the first client's locate check finishes", async () => {
  const events: string[] = [];
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const started = startPairClients(["a", "b"], async (client) => { events.push(`start ${client}`); }, async (client) => {
    events.push(`locate ${client}`);
    await pending;
    events.push("locate passed");
  });
  await Bun.sleep(0);
  expect(events).toEqual(["start a", "locate a"]);
  release?.();
  await started;
  expect(events).toEqual(["start a", "locate a", "locate passed", "start b"]);
});

test("a failed locate never starts the peer", async () => {
  const clients: string[] = [];
  await expect(startPairClients(["a", "b"], async (client) => { clients.push(client); }, async () => { throw new Error("no presence table"); })).rejects.toThrow("no presence table");
  expect(clients).toEqual(["a"]);
});

test("ordinary pool startup still starts both clients without a locate check", async () => {
  const clients: string[] = [];
  await startPairClients(["a", "b"], async (client) => { clients.push(client); });
  expect(clients).toEqual(["a", "b"]);
});
