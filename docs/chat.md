# Chat panel

`ChatPanel` (wisp:src/ui/chatPanel.ts) draws a map's received chat in frames of
its own, above the map's menus, so the map can hide Warcraft's chat frame and
show no line twice. It is presentation only: it reads the chat event and writes
its own frames, and it never touches simulation, rollback or synchronized state.
In Warcraft typing stays in Warcraft's Enter box; the native window has none, so
Wisp gives it a chat line of its own (see Typing in the native window).

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

## The framed box

A style with `frame` (its own backdrop texture, an optional `title` bar with its text, font size, optional
texture and alpha, the scrollbar's and the entry field's textures, and the entry's
placeholder and its colour) draws a framed box when `update` is given a
`ChatSlot` (`{ left, bottom, width, height }`) instead of a `ChatBox`:

```ts
chat.update(FRAME_SECONDS, { left, bottom, width, height }); // a ChatSlot: the framed box
chat.update(FRAME_SECONDS, { left, bottom, width, rows });   // a ChatBox: the recent view
```

- It fills the slot and is always shown: the panel texture as its backdrop, the
  title bar along the top (only when the style gives a `title`; without one the lines fill that space), every kept line at full opacity, newest at the bottom,
  as many rows as fit (at most `historyRows`), with a scrollbar beside them whose
  thumb is the shown rows' share of the rows the history wraps to.
- Its lines come from the chat event, so in Warcraft what a player types in the
  Enter box shows here, and in the native window what they type in the box's
  entry line; both builds show lines through that one path. The box has no
  scrolling input: the newest rows show.
- The layout is wisp:src/ui/chatFrame.ts, a pure function tested with the rest
  of the chat code.

## Typing in the native window

Warcraft has an Enter box and the native window does not, so Wisp's runtime
keeps a chat line per client (wisp:src/headless/chatEntry.ts), the window's
stand-in for it:

- Enter opens it, and so does a left click where the map draws it; each typed
  character goes in (the window sends the character a press types on the
  player's layout), Backspace takes the last one back, Enter sends it and
  Escape closes it unsent. An empty line sends nothing.
- While it is open the game hears no key the player presses; the release of a
  key pressed before it opened still reaches the game, so no key stays held.
- Sending is the player's chat event on every client, through the lockstep like
  a key, so `registerChatEvents`, the panel and the map's own chat commands
  (such as Smashcraft's `-dev` lines) run as they do for Warcraft's Enter box.
- The line is local and never synchronized. The map reads it with
  `WispChatEntryText()` (the text while open, undefined while closed) and tells
  the runtime where it draws it with `WispSetChatEntryArea(left, bottom, width,
  height)`; both are Wisp's own natives, absent in Warcraft, so `ChatPanel`
  makes its entry line only when `typeof WispChatEntryText === "function"`.
- `ChatPanel` draws the line: in the framed box it is the bottom line, showing
  the placeholder until the player types, then the text with a blinking caret;
  in the recent view it appears at the box's bottom only while the player types,
  with every kept line above it.
  A panel given no box (`update(seconds, undefined)`) or a box with no lines
  hides the entry line too, including the placeholder left from the framed box;
  `isTyping()` tells a map whether the line is open, so it can keep a box up
  for it.
