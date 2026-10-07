import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Layer } from "effect";
import { afterAll, expect, test } from "bun:test";
import { type Client, batch, keys, sendsChat, typeText } from "../scripts/warcraft/desktop";
import { type ClientState, type ClientView, ClientWatch } from "../scripts/wisp/watch";

// xdotool and wlrctl stand-ins that record what they were asked to send.
const folder = mkdtempSync(join(tmpdir(), "wisp-desktop-chat-"));
const sent = join(folder, "sent");
const tool = join(folder, "tool");
writeFileSync(tool, `#!/bin/sh\necho "$*" >> "${sent}"\n`);
chmodSync(tool, 0o755);
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const client: Client = {
  name: "a",
  documents: "/not/a/prefix/Documents/Warcraft III",
  menuReportPort: 47_001,
  tools: { grim: tool, xdotool: tool, wlrctl: tool, tesseract: tool },
  x11: {},
  wayland: {},
  window: "42",
};

const watched = (state: ClientState, menus = true) => Layer.succeed(ClientWatch, ClientWatch.of({
  view: () => Effect.succeed({ client: "a", state, source: "socket", evidence: "test", at: 0, scan: "done", loadErrors: { count: 0 }, menus } satisfies ClientView),
}));

const send = async (input: Effect.Effect<void, unknown>, watch?: Layer.Layer<ClientWatch>) => {
  writeFileSync(sent, "");
  const exit = await Effect.runPromiseExit(watch === undefined ? input : input.pipe(Effect.provide(watch)));
  return { exit, sent: readFileSync(sent, "utf8") };
};

const chat = batch(client, [{ kind: "keys", keys: ["Return"] }, { kind: "text", text: "-dev quick" }, { kind: "keys", keys: ["Return"] }]);

test("Return and typed text outside a match are refused before any input reaches the client", async () => {
  const outside: readonly [string, Layer.Layer<ClientWatch>][] = [
    ["Battle.net's channel", watched({ kind: "menus", screen: "CUSTOM_LOBBIES" })],
    ["a lobby", watched({ kind: "lobby", host: true })],
    ["loading", watched({ kind: "loading" })],
    ["the score screen", watched({ kind: "results" })],
    // A receipt without the page can be an earlier match's.
    ["a match without its menu page", watched({ kind: "in match" }, false)],
  ];
  for (const [where, watch] of outside) {
    for (const input of [chat, keys(client, "Return"), keys(client, "shift+KP_Enter"), typeText(client, "gg")]) {
      const { exit, sent } = await send(input, watch);
      expect(Exit.isFailure(exit), where).toBe(true);
      expect(String(Exit.isFailure(exit) && exit.cause)).toContain("refused outside a match");
      expect(sent, where).toBe("");
    }
  }
});

test("without a ClientWatch the client is watched once, and one that can't be watched is refused", async () => {
  const { exit, sent } = await send(chat);
  expect(Exit.isFailure(exit)).toBe(true);
  expect(sent).toBe("");
});

test("in a match its page reports, chat is sent; other keys are never checked", async () => {
  const inMatch = await send(chat, watched({ kind: "in match" }));
  expect(Exit.isSuccess(inMatch.exit)).toBe(true);
  expect(inMatch.sent).toContain("keydown --clearmodifiers Return sleep 0.3 keyup --clearmodifiers Return sleep 0.66");
  expect(inMatch.sent).toContain("type --clearmodifiers --delay 12 -- -dev quick");
  const escape = await send(keys(client, "Escape"), watched({ kind: "menus", screen: "MAIN_MENU" }));
  expect(Exit.isSuccess(escape.exit)).toBe(true);
  expect(escape.sent).toContain("key --clearmodifiers Escape");
  expect(sendsChat(["ctrl+a", "F10"])).toBe(false);
  expect(sendsChat(["ctrl+Return"])).toBe(true);
});
