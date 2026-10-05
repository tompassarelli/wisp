-- The Lua VM is Warcraft's irreducible foreign boundary. This fixture drives
-- the emitted runtime with native stubs, including cached Preloader contents.
local bundlePath, expected = assert(arg[1]), assert(arg[2])
local bundleFile = assert(io.open(bundlePath, "rb"))
local payload = bundleFile:read("a")
bundleFile:close()
local files, cached, tooltips, writes = {}, {}, {}, {}
function BlzSetAbilityTooltip(id, text, level) tooltips[level] = text end
function BlzGetAbilityTooltip(id, level) return tooltips[level] or " " end
function Preloader(name)
  if files[name] == nil then return end
  cached[name] = cached[name] or files[name]
  tooltips[0] = cached[name]
end
local timers, triggers, syncData = {}, {}, nil
PLAYER_SLOT_STATE_PLAYING, MAP_CONTROL_USER = "playing", "user"
function GetPlayerSlotState(p) return p == 0 and "playing" or "empty" end
function GetPlayerController(p) return "user" end
function CreateTimer() return {} end
function TimerGetElapsed(t) return 0.0 end
function TimerStart(t, timeout, periodic, fn) if periodic then timers[#timers + 1] = fn end end
function CreateTrigger() return { actions = {} } end
function TriggerAddAction(t, fn) t.actions[#t.actions + 1] = fn end
function BlzTriggerRegisterPlayerSyncEvent(t, p, prefix) triggers[prefix] = t end
function BlzSendSyncData(prefix, data)
  syncData = data
  for _, fn in ipairs(assert(triggers[prefix], "unexpected sync prefix").actions) do fn() end
  return true
end
function BlzGetTriggerSyncData() return syncData end
function GetLocalPlayer() return 0 end
function GetPlayerId(p) return p end
function Player(n) return n end
local preload = {}
function PreloadGenClear() preload = {} end
function PreloadGenStart() end
function Preload(text) preload[#preload + 1] = text end
function PreloadGenEnd(name) writes[name] = table.concat(preload, "\n") end
function DisplayTextToPlayer(p, x, y, text) end
local module = assert(load(payload))()
module.start()
assert(writes["fixture-hot-ack-p0.txt"] == "applied 0 at 0", "match start was not acknowledged")
module.tick()
module.fail()
local dispatch, errors, hot = __fixtureDispatch, __fixtureErrors, __fixtureHot
local oldHandler = dispatch.handlers["fixture.tick"]
assert(__fixtureTicks == 1 and errors.count == 1)
assert(writes["fixture-error-p0.txt"] == "error 1 in fixture.tick\nfixture failure")
files["fixture-hot-" .. expected:gsub(":", "-") .. "-0.pld"] = payload
files["fixture-hot-manifest-1.pld"] = "1 1 " .. expected
for _, fn in ipairs(timers) do fn() end
assert(__fixtureDispatch == dispatch and __fixtureErrors == errors and __fixtureHot == hot, "persistent state replaced")
assert(hot.applied == 1 and hot.announced == 1 and hot.pending == nil)
assert(dispatch.handlers["fixture.tick"] ~= oldHandler, "handler was not replaced")
assert(writes["fixture-hot-ack-p0.txt"] == "applied 1 at 0.0" or writes["fixture-hot-ack-p0.txt"] == "applied 1 at 0")
module.tick()
module.fail()
assert(__fixtureTicks == 2 and errors.count == 1, "old trampoline or error state lost")
files["fixture-hot-manifest-2.pld"] = "2 1 2:2"
files["fixture-hot-2-2-0.pld"] = "damaged"
for _, fn in ipairs(timers) do fn() end
assert(hot.applied == 1 and hot.pending == nil, "damaged reload was applied")
assert(writes["fixture-hot-ack-p0.txt"] == "applied 1 at 0.0" or writes["fixture-hot-ack-p0.txt"] == "applied 1 at 0")
print("reload contract passed")
