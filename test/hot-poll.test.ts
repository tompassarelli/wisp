// How often the map's reloader looks for files in simulated clients: a lookup
// of a missing file reads a whole folder under Wine, 35 ms for the 94,057 files
// of a dev client's CustomMapData while the hot folder doesn't exist
// (wisp:docs/hot-reload.md). The Lua32 contract of the same rates is
// test/hot-reload-poll.lua.
import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";
import type { Lockstep } from "../src/headless/lockstep";
import { installDispatch } from "../src/platform/dispatch";
import { installHotReload, startHotReload } from "../src/platform/hotReload";
import { configureRuntime } from "../src/runtime/config";

const runtime = installHeadless({ filePrefix: "fixture", globalPrefixes: ["__fixture"] });
afterAll(runtime.restore);

const FRAMES_PER_SECOND = 60;
/** Wine's measured cost of one missing-file lookup in a CustomMapData of 94,057 files with no hot folder. */
const WHOLE_FOLDER_SECONDS = 0.035;

const install = () => {
  configureRuntime({ filePrefix: "fixture", readyPrefix: "FX_HRR", globalPrefix: "__fixture" });
  installDispatch();
  installHotReload();
};
const reloader = { install, start: () => {
  install();
  startHotReload();
} };

const missed = (clients: Lockstep) => clients.clients.map((client) => client.missedLookups);
/** Each client's missing-file lookups while `frames` frames run. */
function lookupsDuring(clients: Lockstep, frames: number): number[] {
  const before = missed(clients);
  clients.frames(frames);
  return missed(clients).map((count, index) => count - (before[index] ?? 0));
}

test("clients no host has prepared look up at most twice a second, which a whole-folder lookup keeps under 0.07 s per second", () => {
  const clients = runtime.clients(reloader);
  clients.start({ hostFolder: false });
  // Start looks for the first manifest and the marker, once.
  for (const count of missed(clients)) expect(count).toBeLessThanOrEqual(2);
  const seconds = 20;
  for (const lookups of lookupsDuring(clients, seconds * FRAMES_PER_SECOND)) {
    expect(lookups).toBeLessThanOrEqual(2 * seconds);
    expect(lookups).toBeGreaterThanOrEqual(seconds);
    expect(lookups * WHOLE_FOLDER_SECONDS / seconds).toBeLessThanOrEqual(0.07);
  }
  expect(clients.unappliedReloads()).toEqual([]);
  expect(clients.firstDivergence()).toBeUndefined();
});

test("the host's marker switches clients to a lookup every poll, and the next reload is then found on the first poll", () => {
  const clients = runtime.clients(reloader);
  clients.start({ hostFolder: false });
  clients.frames(100);
  clients.prepareHostFolder();
  // The marker is found within a second: 32 polls, two frames each.
  clients.frames(64);
  const polls = lookupsDuring(clients, FRAMES_PER_SECOND);
  for (const lookups of polls) expect(lookups).toBe(FRAMES_PER_SECOND / 2);
  clients.reload();
  clients.frames(3);
  expect(clients.unappliedReloads()).toEqual([]);
  expect(clients.firstDivergence()).toBeUndefined();
});

test("a reload published to clients that have seen no host is found within a second", () => {
  const clients = runtime.clients(reloader);
  clients.start({ hostFolder: false });
  clients.frames(100);
  clients.reload();
  // 32 polls, two frames each, and the clients' answers.
  clients.frames(64 + 3);
  expect(clients.unappliedReloads()).toEqual([]);
  expect(clients.firstDivergence()).toBeUndefined();
});

test("clients started after a host prepared the hot folder look up at every poll from the start", () => {
  const clients = runtime.clients(reloader);
  clients.start();
  for (const lookups of lookupsDuring(clients, FRAMES_PER_SECOND)) expect(lookups).toBe(FRAMES_PER_SECOND / 2);
  clients.reload();
  clients.frames(3);
  expect(clients.unappliedReloads()).toEqual([]);
});
