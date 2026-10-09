import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Layer } from "effect";
import { afterAll, expect, test } from "bun:test";
import { type Client, batch, keys, typeText } from "../scripts/warcraft/desktop";
import { type ClientState, type ClientView, ClientWatch } from "../scripts/wisp/watch";


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

test("[repro 533f017] Return and typed text outside a match are refused before any input reaches the client", async () => {
  const outside: readonly [string, Layer.Layer<ClientWatch>][] = [
    ["Battle.net's channel", watched({ kind: "menus", screen: "CUSTOM_LOBBIES" })],
    ["a lobby", watched({ kind: "lobby", host: true })],
    ["loading", watched({ kind: "loading" })],
    ["the score screen", watched({ kind: "results" })],

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
