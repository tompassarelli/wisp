# Chat panel

`ChatPanel` (wisp:src/ui/chatPanel.ts) draws a map's received chat in frames of
its own, above the map's menus, so the map can hide Warcraft's chat frame and
show no line twice. It is presentation only: it reads the chat event and writes
its own frames, and it never touches simulation, rollback or synchronized state.
Typing stays in Warcraft's Enter box.

Why not move Warcraft's chat frame: changing its level or position has crashed
the game, the level at game end with chat on screen. A map that hides it
(for example `BlzHideOriginFrames`) must prove that route with repeated game
ends carrying chat lines; this page does not choose one.

## Using it

```ts
const chat = new ChatPanel({ name: "MyChat", font, fontSize, rowHeight, glyphWidths: FRIZ_QUADRATA_WIDTHS, margin,
  panelTexture, panelAlpha: 190, level: 200, capacity: 100, historyRows: 14,
  recentSeconds: 14.0, fadeSeconds: 3.0, colour: slot => lighten(rgbOf(slot), 45), ignore: text => text.startsWith("-") });
const received = CreateTrigger();
registerChatEvents(received, slots);
TriggerAddAction(received, trampoline("chat"));   // on("chat", () => chat.receive())
const history = CreateTrigger();
registerChatHistoryKey(history, slots, OSKEY_TAB);
TriggerAddAction(history, trampoline("chatHistory")); // on("chatHistory", () => chat.toggleHistory())
// every frame, per screen:
chat.update(FRAME_SECONDS, box);   // box: { left, bottom, width, rows }, or undefined to hide
```

- Lines show in the recent view for `recentSeconds`, fading over the last
  `fadeSeconds`; the history key switches to the last `historyRows` rows at full
  opacity, taller than the recent box and drawn over the map's menus.
- A name shows in its player's colour (`colour(slot)`, 0xRRGGBB) without a
  Battle.net `#tag`; `lighten(rgb, percent)` lifts a saturated player colour so
  it reads on a dark backdrop.
- Wrapping is the module's own and measures text by glyph class
  (`GlyphWidths`, in units of the font size). `FRIZ_QUADRATA_WIDTHS` holds
  Warcraft's chat font, fitted to native captures and rounded up so a row never
  reaches past the box; rows break at spaces and later rows start at the box's
  left edge, because spaces cannot line up with a proportional font.
- `margin` is the padding on every side: the backdrop's top and bottom edges sit
  closer to the rows by the row's spare height, so the text has as much space
  above and below as left and right. Give it a plain texture; a texture with
  drawn edges puts its lines through the text.
- The box is in screen coordinates (0.8 wide, 0.6 high) and grows upward from
  `bottom`; a map passes a different box per screen and keeps it inside the
  4:3 area so 3:2 and 4:3 windows show the same place.
- The registration helpers register every slot, so each client creates the
  same events; only the local player's key toggles the history.

The pure part (`ChatLog`, wrapping, expiry, fade) is wisp:src/ui/chatLog.ts and
is tested by wisp:src/ui/chat.tests.ts.
