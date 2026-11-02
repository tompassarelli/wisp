# Declarative frames

A map's menus are trees of Warcraft frames. Wisp lets a game describe one tree
as typed data on the host, and generates three files from it at build time:
a static FDF file, the TOC that loads it, and a map-side TypeScript module
whose create function returns every frame as a typed handle. The map still
uses Warcraft's own frame system; there is no virtual DOM, renderer or
reactive layer.

Entry points: `generateFrames(definition)`, `frameDefinitionProblems(definition)` and `writeFrames(definition,
importDir, bindingsFile)` in wisp:host/compile/frames.ts. A real panel's
definition is in wisp:test/fixtures/frames/opponentSettings.ts.

## Ways to author Warcraft frames

| Approach | What it is | Cost |
| --- | --- | --- |
| Hand-written FDF + TOC | Frame templates in Blizzard's FDF text format, loaded with `BlzLoadTOCFile`, created with `BlzCreateFrame(name, ...)`, children found with `BlzGetFrameByName(name, context)` | Native and cheap to create, but every frame name is a string typed twice (FDF and script); a typo returns a null handle at run time, and a missing TOC line break fails silently. |
| `BlzCreateFrameByType` wiring | Create each frame in script by type (`"TEXT"`, `"BACKDROP"`, `"GLUETEXTBUTTON"` inheriting `"ScriptDialogButton"`), then size, place, font and texture it with one native call each | No FDF to keep in step, but layout is imperative code: about five natives per frame, with names carried per copy as string suffixes. |
| w3ts `Frame` class | A TypeScript wrapper object per frame over the same natives (`new Frame(...)`, `Frame.fromName`) | Nicer call sites; the names and layout are still strings and code, and the wrapper allocates an object per frame. |
| Wisp definitions (this page) | Typed host data generates the FDF, TOC and bindings | Names, templates and anchors are checked when the map builds; the map calls one create function. Only the FDF features listed below. |

Smashcraft's menus (smashcraft#185) use the second approach: helpers such as
`createText`, `createBackdrop` and `placeTopLeft` in its frames module, and a
`label`/`art`/`cpuButton` closure per panel. Its opponent-settings panel is
14 frames placed by absolute points, with per-player name suffixes. Its one
hand-written FDF (a damage text template) is loaded by its own TOC.

## The smallest definition

A definition names the root frame, its type, size, optional screen position,
texture and level, and its children. Each child has a `key`, which is both
the binding's field name and, capitalized after the definition's name, the
frame's FDF name (`close` in `OpponentSettings` is `OpponentSettingsClose`).
A child can set:

- `type`: `FRAME`, `BACKDROP`, `TEXT` or `GLUETEXTBUTTON`;
- `inherits`: a template defined in this definition, listed in `templates`,
  or a Warcraft template (`ScriptDialogButton`, `EscMenuBackdrop`), inherited
  `WITHCHILDREN`. Generated FDF includes the template's defining file
  (`UI\\FrameDef\\UI\\ScriptDialog.fdf` for `ScriptDialogButton`,
  `UI\\FrameDef\\UI\\EscMenuTemplates.fdf` for `EscMenuBackdrop`)
  before using it: script-side availability does not load templates
  into a custom FDF's template scope;
- `width`, `height` and `points`: `SetPoint` anchors to the parent, `"root"`
  or another child's key;
- `text`, `font` and `justify` for `TEXT`; `text` on a `GLUETEXTBUTTON` is its
  label, which the create function sets;
- `texture` for a `BACKDROP`, stretched over the frame;
- `enabled: false`, which the create function applies so labels and art never
  take a click from the button under them.

Repetition is ordinary TypeScript on the host: the opponent-settings fixture
builds its two stepper rows with one `row()` function. Keys are typed handles
in the generated interface, so a misspelled frame is a type error in the map.

## What is generated

For a definition named `OpponentSettings`:

- `war3mapImported\OpponentSettings.fdf`: one nested `Frame` block per frame.
  Numbers are written in fixed notation, since the FDF parser reads no
  exponents.
- `war3mapImported\OpponentSettings.toc`: the FDF path followed by the blank
  line a TOC needs.
- The bindings module: `OPPONENTSETTINGS_TOC`, an `OpponentSettingsFrames`
  interface with `root` and every key as `Frame` handles, and
  `createOpponentSettings(parent, context)`, written against the game API
  (`import ... from "wisp/game/frames"`, never a raw `Blz` native, so the
  native backend runs it). It calls `loadFrameFile` (each call, since a
  headless run's clients share module state), `createFrame("OpponentSettings",
  parent, 0, context)`, places (`setFrameAbsPoint`) and levels
  (`setFrameLevel`) the root, finds each child with `namedFrame(name,
  context)`, then sets button labels (`setFrameText`) and disables
  (`setFrameEnabled`) `enabled: false` frames. It returns `undefined` when the
  TOC does not load. The module is pure TypeScript over the game API and
  compiles to Lua like any map module.

Use a different `context` per copy (one per player, say) instead of name
suffixes. Every client must create the same frames in the same order; show,
hide and change text per client as before.

`writeFrames` writes the FDF and TOC into an import folder and the bindings
to a file of the map's source, and returns the archive entries a
[MapBuild](../host/compile/mapBuild.ts)'s `imports` take. Run it from the
game's build before the map compiles, so the bindings exist when it does.

## Headless clients

A headless client (wisp:docs/headless.md) reads no FDF. Pass the definitions
as `frames` in the game's `HeadlessMap` (or `LuaHeadlessMap`), and
`BlzCreateFrame(name, ...)` makes the whole tree as Warcraft does: each child
named, parented, sized and placed by its anchors, `TEXT` frames holding their
static text. Clicks, shown text and hiding the root then behave in journeys as
they do for hand-wired frames.

## SIMPLE frames: a sub-rectangle of a texture

Warcraft draws part of a texture only through a SIMPLEFRAME's `Texture` with
`TexCoord left, right, top, bottom` (its own ConsoleUI.fdf cuts the race
console tiles this way); a BACKDROP always draws its texture whole. A
definition with `type: "SIMPLEFRAME"` has `textures` instead of `children`:

```ts
{ name: "RaceArch", type: "SIMPLEFRAME", width: 0.0625, height: 0.125,
  at: { point: "BOTTOMLEFT", x: 0.25, y: 0 },
  textures: [{ key: "tile", layer: "BACKGROUND", file: "UI\\Console\\Human\\HumanUITile01.blp", texCoord: [0.5, 1, 0, 0.5] }] }
```

A texture is `{ key, layer, file?, texCoord?, alphaMode?, width?, height?,
anchor? }`: `layer` is `BACKGROUND` or `ARTWORK`;
`texCoord` is `[left, right, top, bottom]` as shares of the file, each 0..1;
`alphaMode` is `BLEND` or `ALPHAKEY`; `anchor` is `{ point, x, y }` on the
frame. With no `width`, `height` or `anchor` the texture fills the frame
(`SetAllPoints`). The generated FDF is one `Frame "SIMPLEFRAME" "RaceArch"`
with a `Layer` block per used layer holding `Texture "RaceArchTile"` (the
definition's name and the capitalized key). The bindings module's create
function calls `createSimpleFrame("RaceArch", parent, context)` (the game API's `BlzCreateSimpleFrame`), places
the root with `at`, and returns `root` and each texture key as the handle
`namedFrame("RaceArchTile", context)` finds. `setFrameTexture` on a
texture handle changes its file and keeps its `texCoord`; `setFrameSize`,
`setFrameAbsPoint`, `setFramePoint`, `setFrameVisible` and
`setFrameAlpha` on the root move, size, hide and fade its textures.

Warcraft draws only those two layers. In the Classic 3.0.0.24268 client on
2 November 2026 (smashcraft's HUD race frames, one variant per race in one
map), a frame with a `BORDER` or `OVERLAY` block drew its first `BACKGROUND`
texture and nothing else: not the textures in that block, not those in a
later `ARTWORK` block, and not a second `BACKGROUND` texture whose file the
script set. The same textures all drew in one `BACKGROUND` block, in
`BACKGROUND` and `ARTWORK` blocks, and with no `Layer` blocks at all. The
generator therefore refuses any other layer name.

Draw order, as Warcraft does it: every SIMPLEFRAME and its textures draw
beneath every other frame, whatever the levels. Inside one simple frame the
textures draw by layer (`BACKGROUND` under `ARTWORK`), then in definition order. Headless clients report that order in
each frame's `level`, and a texture's `uv` is `[u0, v0, u1, v1]` from the top
left of its file (TexCoord `0.5, 1, 0, 0.5` is `[0.5, 0, 1, 0.5]`). The
native window samples only that sub-rectangle, and `uiReport` and
`headless --bounds` give it as the row's `region`. The Chrome renderer still
draws every texture whole.

## Errors at build time

`generateFrames` throws `FrameDefinitionError` listing every problem;
`frameDefinitionProblems` returns them. It reports a definition name or key
that is not an identifier, a reserved key (`root`, `toc`), a duplicate key or
frame name, an unknown frame type or point, an anchor to a frame the
definition does not have, an unknown template, a SIMPLEFRAME texture with an unknown layer or alpha mode, a `texCoord` outside 0..1 or a texture key that repeats, a quote or line break in a
string the FDF would carry, a `TEXT` with neither font nor template, and a
text, font or texture on a frame type that cannot show it.

## Boundaries

Only the fields above are generated; edit boxes, lists, SIMPLE frames other than a textured SIMPLEFRAME,
tooltips and FDF features beyond them are written by hand or added here when
a game needs them. Clicks, focus and keyboard handling stay in the game's
script (for example its own button-click trigger over the returned handles).
Whether a generated panel looks and behaves like the hand-wired one is checked
in the native game by the consuming map.
