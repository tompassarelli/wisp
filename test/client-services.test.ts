import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { BackgroundServices } from "../host/contract/services";
import { desktopOwner, startDesktop } from "../host/client/clientServices";

test("[scenario] two sessions starting a desktop for client a keep two desktop units", async () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-desktop-units-"));
  const stateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join(root, "state");
  const units = new Map<string, { readonly run: string; active: string }>();
  // Like systemd-run --unit: starting a unit name again replaces whatever ran under it.
  const services = Layer.succeed(BackgroundServices, BackgroundServices.of({
    start: (unit, _command, log) => Effect.sync(() => {
      const replaced = units.get(unit);
      if (replaced !== undefined) replaced.active = "inactive";
      const run = join(root, `run-${units.size}-${unit}`);
      mkdirSync(join(run, "runtime"), { recursive: true });
      writeFileSync(join(run, "runtime/wayland-0"), "");
      writeFileSync(join(run, "display"), ":1\n");
      mkdirSync(join(log!, ".."), { recursive: true });
      writeFileSync(log!, `Run: ${run}\n`, { flag: "a" });
      units.set(unit, { run, active: "active" });
    }),
    state: (unit) => Effect.succeed({ active: units.get(unit)?.active ?? "inactive", since: "", pid: 0 }),
    stop: (unit) => Effect.sync(() => void units.delete(unit)),
    owner: () => Effect.succeed(undefined),
  }));
  const start = (clientsFile: string) => startDesktop("a", ["true"], desktopOwner(join(root, clientsFile)), 5).pipe(Effect.provide(services));

  const first = await Effect.runPromise(start("ad-clients.json"));
  const second = await Effect.runPromise(start("bc-clients.json"));

  expect(units.size).toBe(2);
  expect([...units.values()].map(({ active }) => active)).toEqual(["active", "active"]);
  expect(first).not.toBe(second);
  if (stateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = stateHome;
});
