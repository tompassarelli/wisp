import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit } from "effect";
import { confirmToplevel } from "../host/lan/pool";
import { linuxDesktopLayer } from "../host/os/platform/linux/desktop";
import { InputInjection } from "../host/os/platform/services";
import { type Client, DesktopFailure, ToplevelMissing, toplevelMissing } from "../host/os/warcraft/desktopClient";

describe("pool client toplevel", () => {
  test("[spec docs/lan.md] a pool client whose compositor lists no Warcraft toplevel is restarted once before its pair is up, and its pair fails with a missing toplevel when the restart lists none", () => {
    const run = (listings: readonly boolean[]) => {
      const log: string[] = [];
      let checks = 0;
      const exit = Effect.runSyncExit(confirmToplevel({
        listed: Effect.sync(() => { log.push("listed"); return listings[checks++] ?? false; }),
        restart: Effect.sync(() => { log.push("restart"); }),
        missing: () => new DesktopFailure({ operation: "confirm", client: "lan0b", cause: new ToplevelMissing({ title: "Warcraft III" }) }),
      }));
      return { exit, log };
    };
    expect(run([true])).toEqual({ exit: Exit.void, log: ["listed"] });
    expect(run([false, true])).toEqual({ exit: Exit.void, log: ["listed", "restart", "listed"] });
    const never = run([false, false, true]);
    expect(never.log).toEqual(["listed", "restart", "listed"]);
    expect(Exit.isFailure(never.exit) && toplevelMissing(Cause.squash(never.exit.cause))).toBe(true);
  });

  test("[spec docs/lan.md] a strict Warcraft focus fails with a missing toplevel when wlrctl finds no toplevel, and with an ordinary desktop failure when wlrctl can't ask the compositor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wisp-toplevel-"));
    const tool = (name: string, body: string) => {
      const path = join(dir, name);
      writeFileSync(path, `#!/bin/sh\n${body}\n`);
      chmodSync(path, 0o755);
      return path;
    };
    const focusWith = (wlrctl: string) => {
      const client: Client = { name: "b", documents: dir, tools: { grim: "grim", xdotool: tool("xdotool", "exit 0"), wlrctl, tesseract: "tesseract" }, x11: {}, wayland: {}, window: "1" };
      return Effect.runPromiseExit(InputInjection.use((input) => input.focus(client, "Warcraft III", true)).pipe(Effect.provide(linuxDesktopLayer)));
    };
    const failure = (exit: Exit.Exit<void, DesktopFailure>) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined);
    const none = failure(await focusWith(tool("none", "exit 1")));
    expect(none).toBeInstanceOf(DesktopFailure);
    expect(toplevelMissing(none)).toBe(true);
    expect((none as DesktopFailure).message).toBe("focus Warcraft failed for b: the compositor lists no Warcraft III toplevel");
    const unreachable = failure(await focusWith(tool("unreachable", "echo 'Foreign Toplevel Management interface not found!' >&2; exit 1")));
    expect(unreachable).toBeInstanceOf(DesktopFailure);
    expect(toplevelMissing(unreachable)).toBe(false);
    expect(await focusWith(tool("found", "exit 0"))).toEqual(Exit.void);
  });
});
