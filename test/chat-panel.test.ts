import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../host/headless/headless";
import { createKeyFeed } from "../src/headless/keyInput";
import { unpackKey } from "../host/window/keyEvents";
import { createPointerFeed } from "../src/headless/pointer";
import { ChatPanel, type ChatSlot, type ChatStyle, registerChatEvents } from "../src/ui/chatPanel";
import { FRIZ_QUADRATA_WIDTHS } from "../src/ui/chatLog";

const runtime = installHeadless({ filePrefix: "chatPanel", globalPrefixes: ["__chatPanel"] });
afterAll(runtime.restore);

const STYLE: ChatStyle = {
  name: "TestChat", font: "Fonts\\FRIZQT__.TTF", fontSize: 0.008, rowHeight: 0.0112, glyphWidths: FRIZ_QUADRATA_WIDTHS, margin: 0.005,
  panelTexture: "panel.blp", panelAlpha: 210, level: 400, capacity: 50, historyRows: 8, recentSeconds: 14.0, fadeSeconds: 3.0,
  colour: () => 0xffffff, ignore: (text) => text.startsWith("-"),
  frame: { panelTexture: "framed.blp", title: "Chat", titleFontSize: 0.011, titleTexture: "title.blp", titleAlpha: 230, barTexture: "bar.blp", fieldTexture: "field.blp", placeholder: "Type your chat here", placeholderColour: 0x909090 },
};
const SLOT: ChatSlot = { left: 0.02, bottom: 0.2, width: 0.22, height: 0.12 };
const ENTER = 0x0d;
const press = (key: number, typed?: string) => [unpackKey(key | 1 << 12 | (typed === undefined ? 0 : (typed.codePointAt(0) ?? 0) * (1 << 13))), unpackKey(key)];
const clickAt = (x: number, y: number, pressed: number) => ({ x: (x - 0.4) * 1000 + 400, y: (0.6 - y) * 1000, width: 800, height: 600, inside: true, held: pressed, pressed, released: 0 });

test("[scenario] the framed chat box shows its title, the chat event's lines and, in the native window, an entry line that a click opens and whose sent line comes back through the chat event", () => {
  const panels = new Map<number, ChatPanel>();
  const map = { install: () => {}, start: () => {
    const panel = new ChatPanel(STYLE);
    panels.set(GetPlayerId(GetLocalPlayer()), panel);
    const said = CreateTrigger();
    registerChatEvents(said as never, [0, 1]);
    TriggerAddAction(said, () => { panel.receive(); });
  } };
  const clients = runtime.clients(map, [0, 1]);
  clients.start();
  clients.frames(2);
  const local = clients.client(0);
  const draw = () => { local.run(() => { panels.get(0)?.update(1 / 60, SLOT); }); return local.frames.shownText(); };

  clients.chat(1, "hello there");
  clients.frames(1);
  expect(draw()).toEqual(["|cffffffffPlayer 2|r: hello there", "Chat", "|cff909090Type your chat here"]);

  createPointerFeed(clients, 0)(clickAt(0.05, 0.21, 1));
  expect(local.chatEntry.text).toBe("");
  createKeyFeed(clients, 0)([...press(0x47, "g"), ...press(0x47, "g")]);
  expect(draw().at(-1)?.startsWith("gg")).toBe(true);
  createKeyFeed(clients, 0)(press(ENTER));
  clients.frames(1);
  expect(draw()).toEqual(["|cffffffffPlayer 2|r: hello there", "|cffffffffPlayer 1|r: gg", "Chat", "|cff909090Type your chat here"]);
});
