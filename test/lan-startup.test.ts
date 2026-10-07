import { expect, test } from "bun:test";
import { startPairClients, waitForFirstClient } from "../scripts/wisp/lan/startup";

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

test("locate waits for a delayed Warcraft process rather than the native launcher", async () => {
  const events: string[] = [];
  let polls = 0;
  await startPairClients(["a", "b"], async (client) => { events.push(`start ${client}`); }, async () => {
    await waitForFirstClient(() => polls === 3, () => false, async () => { polls++; events.push("waiting for Warcraft"); });
    events.push("locate a");
  });
  expect(events).toEqual(["start a", "waiting for Warcraft", "waiting for Warcraft", "waiting for Warcraft", "locate a", "start b"]);
});

test("an exited native launcher fails before locate or peer startup", async () => {
  const events: string[] = [];
  await expect(startPairClients(["a", "b"], async (client) => { events.push(`start ${client}`); }, async () => {
    await waitForFirstClient(() => false, () => true, async () => {});
    events.push("locate a");
  })).rejects.toThrow("native launcher stopped");
  expect(events).toEqual(["start a"]);
});

test("a missing Warcraft process stops at the startup deadline", async () => {
  let polls = 0;
  await expect(waitForFirstClient(() => false, () => false, async () => { polls++; })).rejects.toThrow("within 60 s");
  expect(polls).toBe(240);
});
