-- The Lua VM is Warcraft's irreducible foreign boundary. This fixture drives
-- the emitted runtime with native stubs, including cached Preloader contents.
local bundlePath = assert(arg[1])
local hotFiles = dofile(arg[0]:match("^(.*[/\\])") .. "hot-reload-files.lua")
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
function GetTriggerPlayer() return 0 end
function GetLocalPlayer() return 0 end
function GetPlayerId(p) return p end
function Player(n) return n end
local preload = {}
function PreloadGenClear() preload = {} end
function PreloadGenStart() end
function Preload(text) preload[#preload + 1] = text end
function PreloadGenEnd(name) writes[name] = table.concat(preload, "\n") end
function DisplayTextToPlayer(p, x, y, text) end
-- A host prepared the hot folder before the match, as `wisp fresh` does.
files["fixture-hot\\host.pld"] = "host"
local module = assert(load(payload))()
module.start()
assert(writes["fixture-hot-ack-p0.txt"] == "applied 0 at 0", "match start was not acknowledged")
module.tick()
module.fail()
local dispatch, errors, hot = __fixtureDispatch, __fixtureErrors, __fixtureHot
local oldHandler = dispatch.handlers["fixture.tick"]
assert(__fixtureTicks == 1 and errors.count == 1)
assert(writes["fixture-error-p0.txt"] == "error 1 in fixture.tick\nfixture failure")
local first = hotFiles.version("fixture", 1, payload)
for name, text in pairs(first.payloads) do files[name] = text end
files[first.manifestName] = first.manifest
for _, fn in ipairs(timers) do fn() end
assert(__fixtureDispatch == dispatch and __fixtureErrors == errors and __fixtureHot == hot, "persistent state replaced")
assert(hot.applied == 1 and hot.decided == 1 and hot.pending == nil and hot.prepared == nil)
assert(hot.state == first.state and hot.modules.bundle.hash == first.hash, "installed modules not recorded")
assert(dispatch.handlers["fixture.tick"] ~= oldHandler, "handler was not replaced")
assert(writes["fixture-hot-ack-p0.txt"] == "applied 1 at 0.0" or writes["fixture-hot-ack-p0.txt"] == "applied 1 at 0")
module.tick()
module.fail()
assert(__fixtureTicks == 2 and errors.count == 1, "old trampoline or error state lost")
files["fixture-hot\\manifest-2.pld"] = "2 2:2 1 - 0"
files["fixture-hot\\2-2-0.pld"] = "damaged"
for _, fn in ipairs(timers) do fn() end
assert(hot.applied == 1 and hot.decided == 2 and hot.pending == nil, "damaged reload was applied")
assert(writes["fixture-hot-ack-p0.txt"] == "applied 1 at 0.0" or writes["fixture-hot-ack-p0.txt"] == "applied 1 at 0")
-- Version 3 offers a delta from version 1, which this client runs: it reads the delta, not the full payload.
local third = hotFiles.version("fixture", 3, payload .. "\n-- version 3\n", first)
for name, text in pairs(third.payloads) do files[name] = text end
files[third.manifestName] = third.manifest
for _, fn in ipairs(timers) do fn() end
assert(hot.applied == 3 and hot.state == third.state and hot.modules.bundle.hash == third.hash, "the delta was not applied")
local thirdKey, firstKey = third.state:gsub(":", "-"), first.state:gsub(":", "-")
assert(cached["fixture-hot\\" .. thirdKey .. "-" .. firstKey .. "-0.pld"] ~= nil, "the delta was not read")
assert(cached["fixture-hot\\" .. thirdKey .. "-0.pld"] == nil, "the full payload was read")
print("reload contract passed")
