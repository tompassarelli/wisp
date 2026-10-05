-- The Lua VM is Warcraft's irreducible foreign boundary. This fixture drives
-- the emitted reloader through the file lookups one client makes while no host
-- has been seen, with Wine's cost of a missing file modeled on every lookup:
-- reading the folder that should hold it, which is all of CustomMapData while
-- the hot folder is missing too.
local bundlePath = assert(arg[1])
local bundleFile = assert(io.open(bundlePath, "rb"))
local payload = bundleFile:read("a")
bundleFile:close()

local TICKS_PER_SECOND = 32
-- Measured on the dev host: a missing-file lookup read all 94,057 files of CustomMapData in 32-35 ms.
local MAP_DATA_FILES, MAP_DATA_MICROSECONDS = 94057, 35000
local ENTRY_MICROSECONDS = MAP_DATA_MICROSECONDS / MAP_DATA_FILES
local HOT_FOLDER = "fixture-hot\\"
local HOST_FILE = HOT_FOLDER .. "host.pld"
-- What a second of game may spend on lookups before a host is seen: two lookups, each of the whole CustomMapData.
-- Costs are in whole microseconds because 32-bit floats would round their sums.
local IDLE_MICROSECONDS_PER_SECOND = 2 * MAP_DATA_MICROSECONDS

-- The reference payload checksum: two polynomial lanes, one byte at a time.
local function checksum(text)
  local first, second = 0, 0
  for index = 1, #text do
    local byte = string.byte(text, index)
    first = (first * 257 + byte + 1) % 8165329
    second = (second * 263 + byte + 1) % 8165323
  end
  return first .. ":" .. second
end

local sum = checksum(payload)
local payloadName = HOT_FOLDER .. (sum:gsub(":", "-")) .. "-0.pld"

-- One client in its own environment, with its files, its Preloader cache and a count of polls.
-- `before` puts files in place before the map starts, as a host does.
local function client(before)
  local self = { files = {}, cached = {}, tooltips = {}, triggers = {}, timers = {}, timerStarts = {}, lookups = 0, missed = 0, cost = 0, ticks = 0, sent = 0 }
  local env = setmetatable({}, { __index = _G })
  env._G = env
  env.load = function(text, name) return load(text, name, "t", env) end
  env.PLAYER_SLOT_STATE_PLAYING, env.MAP_CONTROL_USER = "playing", "user"
  function env.BlzSetAbilityTooltip(id, text, level) self.tooltips[level] = text end
  function env.BlzGetAbilityTooltip(id, level) return self.tooltips[level] or " " end
  function env.Preloader(name)
    self.lookups = self.lookups + 1
    if self.files[name] == nil then
      self.missed = self.missed + 1
      local entries = 0
      for existing in pairs(self.files) do
        if existing:sub(1, #HOT_FOLDER) == HOT_FOLDER then entries = entries + 1 end
      end
      self.cost = self.cost + (entries == 0 and MAP_DATA_MICROSECONDS or entries * ENTRY_MICROSECONDS)
      return
    end
    self.cached[name] = self.cached[name] or self.files[name]
    self.tooltips[0] = self.cached[name]
  end
  function env.GetPlayerSlotState(p) return p == 0 and "playing" or "empty" end
  function env.GetPlayerController(p) return "user" end
  function env.CreateTimer() return {} end
  function env.TimerGetElapsed(t) return self.ticks / TICKS_PER_SECOND end
  function env.TimerStart(t, timeout, periodic, fn)
    self.timerStarts[#self.timerStarts + 1] = { timeout = timeout, periodic = periodic }
    if periodic then self.timers[#self.timers + 1] = fn end
  end
  function env.CreateTrigger() return { actions = {} } end
  function env.TriggerAddAction(t, fn) t.actions[#t.actions + 1] = fn end
  function env.BlzTriggerRegisterPlayerSyncEvent(t, p, prefix) self.triggers[prefix] = t end
  function env.BlzSendSyncData(prefix, data)
    self.sent = self.sent + 1
    self.event = data
    for _, fn in ipairs(assert(self.triggers[prefix], "unexpected sync prefix").actions) do fn() end
    return true
  end
  function env.BlzGetTriggerSyncData() return self.event end
  function env.GetTriggerPlayer() return 0 end
  function env.GetLocalPlayer() return 0 end
  function env.GetPlayerId(p) return p end
  function env.Player(n) return n end
  function env.PreloadGenClear() end
  function env.PreloadGenStart() end
  function env.Preload(text) end
  function env.PreloadGenEnd(name) end
  function env.DisplayTextToPlayer(p, x, y, text) end
  before(self)
  local module = assert(load(payload, "=map", "t", env))()
  module.start()
  self.startup = { lookups = self.lookups, cost = self.cost }
  self.hot = env.__fixtureHot
  return self
end

local function tick(c, count)
  for _ = 1, count do
    c.ticks = c.ticks + 1
    for _, fn in ipairs(c.timers) do fn() end
  end
end

-- Ticks until `done`, at most `limit`; returns the ticks it took.
local function tickUntil(c, limit, done)
  for taken = 1, limit do
    tick(c, 1)
    if done() then return taken end
  end
  error("not done within " .. limit .. " ticks")
end

-- What `count` ticks looked up, and what Wine would charge for it.
local function measure(c, count)
  local lookups, missed, cost = c.lookups, c.missed, c.cost
  tick(c, count)
  return { lookups = c.lookups - lookups, missed = c.missed - missed, cost = c.cost - cost }
end

local function publishManifest(c, version)
  c.files[payloadName] = payload
  c.files[HOT_FOLDER .. "manifest-" .. version .. ".pld"] = version .. " 1 " .. sum
end

-- The poll timer is created once, at the poll rate, and never restarted: its state must be alike in every client.
local function assertTimerNeverChanges(c, name)
  local periodic = 0
  for _, started in ipairs(c.timerStarts) do
    if started.periodic then
      periodic = periodic + 1
      assert(started.timeout == 1 / TICKS_PER_SECOND, name .. ": poll timer started at " .. started.timeout)
    end
  end
  assert(periodic == 1, name .. ": " .. periodic .. " periodic timers started")
end

-- No host in sight: ten seconds of polls make two lookups a second, at most 0.07 s of lookups per second of game.
local alone = client(function() end)
assert(alone.hot.unseen ~= nil, "a client with no host in sight polls slowly")
assert(alone.startup.lookups <= 2 and alone.startup.cost <= IDLE_MICROSECONDS_PER_SECOND, "start looks up the first manifest and the marker, once")
local idle = measure(alone, 10 * TICKS_PER_SECOND)
assert(idle.lookups == 20 and idle.missed == 20, "lookups before a host is seen: " .. idle.lookups .. " in 10 s")
assert(idle.cost <= 10 * IDLE_MICROSECONDS_PER_SECOND, "lookup cost before a host is seen: " .. idle.cost .. " us in 10 s")
assert(alone.sent == 0 and alone.hot.applied == 0 and alone.hot.unseen ~= nil)
assertTimerNeverChanges(alone, "alone")

-- The host's marker appears: found within a second, and every poll looks for the manifest from then on.
local marked = client(function() end)
tick(marked, 102)
marked.files[HOST_FILE] = "host"
local found = tickUntil(marked, TICKS_PER_SECOND, function() return marked.hot.unseen == nil end)
assert(found <= TICKS_PER_SECOND, "marker found after " .. found .. " polls")
local fast = measure(marked, TICKS_PER_SECOND)
assert(fast.missed == TICKS_PER_SECOND, "polls with the marker seen: " .. fast.missed .. " lookups in 1 s")
assert(fast.cost < 1000, "the hot folder keeps those lookups cheap: " .. fast.cost .. " us in 1 s")
-- Its first reload is then found on the next poll.
publishManifest(marked, 1)
local latency = tickUntil(marked, 4, function() return marked.hot.applied == 1 end)
assert(latency == 1, "the first reload after the marker took " .. latency .. " polls")
assertTimerNeverChanges(marked, "marked")

-- A manifest appears with no marker: found within a second, answered, and polled for at full rate.
local manifested = client(function() end)
tick(manifested, 102)
publishManifest(manifested, 1)
local slowest = tickUntil(manifested, TICKS_PER_SECOND, function() return manifested.hot.applied == 1 end)
assert(slowest <= TICKS_PER_SECOND, "manifest found after " .. slowest .. " polls")
assert(manifested.hot.unseen == nil, "a manifest is a host in sight")
assert(measure(manifested, TICKS_PER_SECOND).missed == TICKS_PER_SECOND)
assertTimerNeverChanges(manifested, "manifested")

-- A client whose hot folder a host already prepared polls at full rate from the start.
local prepared = client(function(c) c.files[HOST_FILE] = "host" end)
assert(prepared.hot.unseen == nil and prepared.startup.lookups == 2, "start with the marker present")
assert(measure(prepared, TICKS_PER_SECOND).missed == TICKS_PER_SECOND)
publishManifest(prepared, 1)
assert(tickUntil(prepared, 4, function() return prepared.hot.applied == 1 end) == 1)

-- So does one whose folder holds manifests from an earlier session.
local earlier = client(function(c)
  for version = 1, 3 do c.files[HOT_FOLDER .. "manifest-" .. version .. ".pld"] = version .. " 1 1:1" end
end)
assert(earlier.hot.unseen == nil and earlier.hot.next == 4, "start with manifests from an earlier session")
assert(measure(earlier, TICKS_PER_SECOND).missed == TICKS_PER_SECOND)
print("poll rate contract passed")
