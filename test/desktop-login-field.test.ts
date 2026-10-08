// The sign-in field typing doctor uses (desktop.enterLoginField), against
// xdotool and wlrctl stand-ins that record what they were asked to do.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { afterAll, expect, test } from "bun:test";
import { type Client, enterLoginField } from "../scripts/warcraft/desktop";

const folder = mkdtempSync(join(tmpdir(), "wisp-login-field-"));
const sent = join(folder, "sent");
const tool = join(folder, "tool");
// The login window, 42, keeps focus; typed bytes are recorded after the arguments.
writeFileSync(tool, `#!/bin/sh\necho "$*" >> "${sent}"\nif [ "$1" = getactivewindow ]; then echo 42; fi\nif [ "$1" = type ]; then cat >> "${sent}"; echo >> "${sent}"; fi\n`);
chmodSync(tool, 0o755);
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const client: Client = { name: "a", documents: "/not/a/prefix", tools: { grim: tool, xdotool: tool, wlrctl: tool, tesseract: tool }, x11: {}, wayland: {}, window: "42" };

test("[reference] the account name is typed into the focused field as wc3-login-field types it: no pointer, then Return", async () => {
  writeFileSync(sent, "");
  const secret = new TextEncoder().encode("someone@example.com");
  const exit = await Effect.runPromiseExit(enterLoginField(client, "Battle.net", undefined, secret));
  expect(Exit.isSuccess(exit)).toBe(true);
  const lines = readFileSync(sent, "utf8").trim().split("\n");
  expect(lines.filter((line) => /mousemove|mousedown|getmouselocation|ctrl\+a/.test(line))).toEqual([]);
  expect(lines).toContain("type --clearmodifiers --file -");
  expect(lines).toContain("someone@example.com");
  expect(lines.at(-1)).toBe("key --clearmodifiers Return");
  expect(secret.every((byte) => byte === 0)).toBe(true);
});
