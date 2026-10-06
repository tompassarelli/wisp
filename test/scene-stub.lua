-- The Lua VM is Warcraft's irreducible foreign boundary. This fixture plays
-- a game's effect calls against the emitted scene recorder and prints the
-- report it writes, as Warcraft's Preload file.
local bundle = assert(io.open(assert(arg[1]), "rb"))
local payload = bundle:read("a")
bundle:close()
local calls, timers, writes, preload = {}, {}, {}, {}
local function native(name) return function(handle, ...) calls[#calls + 1] = name; return handle end end
-- Effects start on the ground, which this fixture's game parks hidden effects on.
function AddSpecialEffect(model, x, y) calls[#calls + 1] = "AddSpecialEffect"; return { model = model, x = x, y = y, z = -1800.0 } end
function AddSpecialEffectLoc(model, where) return { model = model, x = 0.0, y = 0.0, z = -1800.0 } end
function AddSpecialEffectTarget(model, target, point) return { model = model, x = 0.0, y = 0.0, z = 0.0 } end
function BlzSetSpecialEffectPosition(effect, x, y, z) effect.x, effect.y, effect.z = x, y, z end
function BlzGetLocalSpecialEffectX(effect) return effect.x end
function BlzGetLocalSpecialEffectY(effect) return effect.y end
function BlzGetLocalSpecialEffectZ(effect) return effect.z end
DestroyEffect = native("DestroyEffect")
BlzSetSpecialEffectAlpha = native("BlzSetSpecialEffectAlpha")
BlzSetSpecialEffectScale = native("BlzSetSpecialEffectScale")
BlzSetSpecialEffectMatrixScale = native("BlzSetSpecialEffectMatrixScale")
BlzResetSpecialEffectMatrix = native("BlzResetSpecialEffectMatrix")
function CreateUnit(owner, unitType, x, y, facing) return { unitType = unitType } end
RemoveUnit = native("RemoveUnit")
ShowUnit = native("ShowUnit")
SetUnitVertexColor = native("SetUnitVertexColor")
SetUnitScale = native("SetUnitScale")
function CreateTimer() return {} end
function TimerStart(t, timeout, periodic, fn) timers[#timers + 1] = fn end
function GetLocalPlayer() return 0 end
function GetPlayerId(p) return p end
function PreloadGenClear() preload = {} end
function PreloadGenStart() end
function Preload(text) preload[#preload + 1] = text end
function PreloadGenEnd(name) writes[name] = preload end
local module = assert(load(payload))()
module.start()
local function at(frame) __fixtureFrame = frame end
local function report() for _, fn in ipairs(timers) do fn() end end
local function shown(model) local effect = AddSpecialEffect(model, 0.0, 0.0); BlzSetSpecialEffectPosition(effect, 0.0, 0.0, 0.0); return effect end

at(0)
local deck = shown("war3mapImported\\Deck.mdx")
BlzSetSpecialEffectMatrixScale(deck, 12.0, 1.0, 1.0)
shown("")
local spark = AddSpecialEffect("Abilities\\Spark.mdx", 0.0, 0.0)
-- Collapsed in view: its particle emitters still run.
BlzSetSpecialEffectScale(shown("Abilities\\Trap.mdx"), 0.0)
BlzSetSpecialEffectMatrixScale(shown("Flat.mdx"), 1.0, 0.0, 1.0)
local gone = shown("Gone.mdx")
-- Units draw while shown: a hero hidden from 20 to 30, a faded one, a removed one and an unrecorded type.
local hero = CreateUnit(0, 1, 0.0, 0.0, 0.0)
SetUnitVertexColor(CreateUnit(0, 1, 0.0, 0.0, 0.0), 255, 255, 255, 0)
local removed = CreateUnit(0, 1, 0.0, 0.0, 0.0)
CreateUnit(0, 2, 0.0, 0.0, 0.0)
report()
at(20) BlzSetSpecialEffectPosition(spark, 0.0, 0.0, 0.0) ShowUnit(hero, false) report()
at(29) BlzSetSpecialEffectPosition(spark, 0.0, 0.0, -1800.0) report()
-- A pooled puff reused while still shown, its use renewed every 10 frames
-- between reports: each use parks it first, so each is a stay of its own.
-- Smoke moved in view without parking stays: it counts from its first placement.
local puff = AddSpecialEffect("Abilities\\Puff.mdx", 0.0, 0.0)
local smoke = AddSpecialEffect("Abilities\\Smoke.mdx", 0.0, 0.0)
for use = 0, 3 do
  at(30 + 10 * use)
  if use == 0 then ShowUnit(hero, true) end
  BlzSetSpecialEffectPosition(puff, 0.0, 0.0, -1800.0)
  BlzSetSpecialEffectPosition(puff, 5.0 * use, 0.0, 0.0)
  BlzSetSpecialEffectPosition(smoke, 3.0 * use, 0.0, 0.0)
end
at(68) BlzSetSpecialEffectPosition(puff, 0.0, 0.0, -1800.0) BlzSetSpecialEffectPosition(smoke, 0.0, 0.0, -1800.0) report()
at(90) DestroyEffect(gone) RemoveUnit(removed)
-- A rematch restarts the game's frames; the report's clock keeps rising.
at(0) report()
at(10) report()
assert(calls[1] == "AddSpecialEffect" and calls[2] == "BlzSetSpecialEffectMatrixScale", "wrapped natives were not called")
io.write("function PreloadFiles takes nothing returns nothing\r\n\tcall PreloadStart()\r\n")
for _, line in ipairs(writes["fixture-scene-p0.txt"]) do io.write("\tcall Preload( \"" .. line .. "\" )\r\n") end
io.write("\tcall PreloadEnd( 0.0 )\r\n\r\nendfunction\r\n")
