




import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";
import type { Lockstep } from "../src/headless/lockstep";
import { installDispatch } from "../src/platform/dispatch";
import { installHotReload, startHotReload } from "../src/platform/hotReload";
import { configureRuntime } from "../src/runtime/config";

const runtime = installHeadless({ filePrefix: "fixture", globalPrefixes: ["__fixture"] });
afterAll(runtime.restore);

const FRAMES_PER_SECOND = 60;

const POLLS_PER_SECOND = 32;

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

function lookupsDuring(clients: Lockstep, frames: number): number[] {
  const before = missed(clients);
  clients.frames(frames);
  return missed(clients).map((count, index) => count - (before[index] ?? 0));
}

test("[spec docs/hot-reload.md] clients no host has prepared look up at most twice a second, which a whole-folder lookup keeps under 0.07 s per second", () => {
  const clients = runtime.clients(reloader);
  clients.start({ hostFolder: false });

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

test("[spec docs/hot-reload.md] the host's marker switches clients to a lookup every poll, and the next reload is then found on the first poll", () => {
  const clients = runtime.clients(reloader);
  clients.start({ hostFolder: false });
  clients.frames(100);
  clients.prepareHostFolder();

  clients.frames(64);
  const polls = lookupsDuring(clients, FRAMES_PER_SECOND);
  for (const lookups of polls) expect(lookups).toBe(POLLS_PER_SECOND);
  clients.reload();
  clients.frames(3);
  expect(clients.unappliedReloads()).toEqual([]);
  expect(clients.firstDivergence()).toBeUndefined();
});
