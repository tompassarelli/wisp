-- The Lua VM is Warcraft's irreducible foreign boundary. This fixture runs the
-- emitted runtime as two clients in lockstep: each has its own globals,
-- natives, files and Preloader cache; every synchronized message reaches both
-- clients in send order, one step after it was sent.
local bundlePath = assert(arg[1])
local hotFiles = dofile(arg[0]:match("^(.*[/\\])") .. "hot-reload-files.lua")
local bundleFile = assert(io.open(bundlePath, "rb"))
local payload = bundleFile:read("a")
bundleFile:close()

local network = {}
local stepCount = 0

local function client(slot)
  local self = { slot = slot, files = {}, cached = {}, tooltips = {}, writes = {}, messages = {}, timers = {}, registrations = {}, event = {}, sent = 0 }
  local env = setmetatable({}, { __index = _G })
  env._G = env
  env.load = function(text, name) return load(text, name, "t", env) end
  env.PLAYER_SLOT_STATE_PLAYING, env.MAP_CONTROL_USER = "playing", "user"
  function env.BlzSetAbilityTooltip(id, text, level) self.tooltips[level] = text end
  function env.BlzGetAbilityTooltip(id, level) return self.tooltips[level] or " " end
  function env.Preloader(name)
    if self.files[name] == nil then return end
    self.cached[name] = self.cached[name] or self.files[name]
    self.tooltips[0] = self.cached[name]
  end
  function env.GetPlayerSlotState(p) return (p == 0 or p == 1) and "playing" or "empty" end
  function env.GetPlayerController(p) return "user" end
  function env.CreateTimer() return {} end
  function env.TimerGetElapsed(t) return stepCount / 32 end
  function env.TimerStart(t, timeout, periodic, fn) if periodic then self.timers[#self.timers + 1] = fn end end
  function env.CreateTrigger() return { actions = {} } end
  function env.TriggerAddAction(t, fn) t.actions[#t.actions + 1] = fn end
  function env.BlzTriggerRegisterPlayerSyncEvent(t, p, prefix) self.registrations[#self.registrations + 1] = { trigger = t, player = p, prefix = prefix } end
  function env.BlzSendSyncData(prefix, data)
    self.sent = self.sent + 1
    network[#network + 1] = { sender = slot, prefix = prefix, data = data }
    return true
  end
  function env.BlzGetTriggerSyncData() return self.event.data end
  function env.GetTriggerPlayer() return self.event.sender end
  function env.GetLocalPlayer() return slot end
  function env.GetPlayerId(p) return p end
  function env.Player(n) return n end
  local preload = {}
  function env.PreloadGenClear() preload = {} end
  function env.PreloadGenStart() end
  function env.Preload(text) preload[#preload + 1] = text end
  function env.PreloadGenEnd(name) self.writes[name] = table.concat(preload, "\n") end
  function env.DisplayTextToPlayer(p, x, y, text) self.messages[#self.messages + 1] = text end
  self.env = env
  -- A host prepared the hot folder before the match, as `wisp fresh` does.
  self.files["fixture-hot\\host.pld"] = "host"
  local module = assert(load(payload, "=map", "t", env))()
  module.start()
  return self
end

local clients = { client(0), client(1) }
local a, b = clients[1], clients[2]
local function hot(c) return c.env.__fixtureHot end

-- One game step: each client's timers, then every message sent before this step.
local function step()
  stepCount = stepCount + 1
  for _, c in ipairs(clients) do
    for _, fn in ipairs(c.timers) do fn() end
  end
  local queue = network
  network = {}
  for _, message in ipairs(queue) do
    for _, c in ipairs(clients) do
      for _, r in ipairs(c.registrations) do
        if r.player == message.sender and r.prefix == message.prefix then
          c.event = message
          for _, fn in ipairs(r.trigger.actions) do fn() end
        end
      end
    end
  end
end

-- A version's payload files, each cut short by `damage` bytes in this client when given; then its manifest.
local function publishPayload(c, version, damage)
  for name, text in pairs(version.payloads) do c.files[name] = damage and text:sub(1, -damage - 1) or text end
end
local function publishManifest(c, version) c.files[version.manifestName] = version.manifest end

-- Steps until both clients decided `version`; returns the step on which each applied it.
local function settle(version)
  local applied = {}
  for _ = 1, 20 do
    step()
    for index, c in ipairs(clients) do
      if applied[index] == nil and hot(c).applied == version then applied[index] = stepCount end
    end
    if hot(a).decided >= version and hot(b).decided >= version then return applied end
  end
  error("version " .. version .. " was not decided")
end

-- Version 1: client A finds its manifest first; B loads from A's answer before its own manifest exists.
local first = hotFiles.version("fixture", 1, payload)
publishPayload(a, first)
publishPayload(b, first)
publishManifest(a, first)
local applied = settle(1)
assert(applied[1] ~= nil and applied[1] == applied[2], "clients installed version 1 on different steps")
assert(a.sent == 1 and b.sent == 1, "each client answers a version once")
for _, c in ipairs(clients) do
  assert(hot(c).applied == 1 and hot(c).pending == nil and hot(c).prepared == nil)
  assert(hot(c).state == first.state, "installed state not recorded")
  assert(c.writes["fixture-hot-ack-p" .. c.slot .. ".txt"]:match("^applied 1 at "), "missing acknowledgement")
end
publishManifest(b, first)
for _ = 1, 3 do step() end
assert(a.sent == 1 and b.sent == 1, "a decided version was answered again")

-- Version 2 offers a delta from version 1, and B's copy of it is damaged, so neither client installs it.
local second = hotFiles.version("fixture", 2, payload .. "\n-- version 2\n", first)
publishPayload(a, second)
publishPayload(b, second, 2)
publishManifest(a, second)
publishManifest(b, second)
settle(2)
for _, c in ipairs(clients) do assert(hot(c).applied == 1 and hot(c).decided == 2 and hot(c).state == first.state, "a refused version was applied") end
assert(a.messages[#a.messages] == "hot reload 2 not applied: another client couldn't load it", a.messages[#a.messages])
assert(b.messages[#b.messages] == "hot reload 2 not applied: payload missing or damaged", b.messages[#b.messages])

-- Version 3, a delta from version 1 again: both clients find their manifests on the same step and install together.
local third = hotFiles.version("fixture", 3, payload .. "\n-- version 3\n", first)
publishPayload(a, third)
publishPayload(b, third)
publishManifest(a, third)
publishManifest(b, third)
applied = settle(3)
assert(applied[1] ~= nil and applied[1] == applied[2], "clients installed version 3 on different steps")
assert(a.sent == 3 and b.sent == 3)
for _, c in ipairs(clients) do
  assert(c.writes["fixture-hot-ack-p" .. c.slot .. ".txt"]:match("^applied 3 at "))
  assert(hot(c).state == third.state and hot(c).modules.bundle.hash == third.hash)
end
print("lockstep reload contract passed")
