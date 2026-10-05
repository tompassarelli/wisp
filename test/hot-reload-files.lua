-- The files `wisp hot` writes for a version, for the Lua reload fixtures: a
-- whole bundle published as one module (wisp:src/runtime/modules.ts), built
-- here independently of the runtime under test.
local files = {}

-- The reference payload checksum: two polynomial lanes, one byte at a time.
function files.checksum(text)
  local first, second = 0, 0
  for index = 1, #text do
    local byte = string.byte(text, index)
    first = (first * 257 + byte + 1) % 8165329
    second = (second * 263 + byte + 1) % 8165323
  end
  return first .. ":" .. second
end

local function key(sum) return (sum:gsub(":", "-")) end

-- Version `version` of `bundle` under `prefix`; with `base`, an earlier
-- version every client installed, it also offers the delta from it.
-- Returns its state, module hash, payload files by name and manifest line.
function files.version(prefix, version, bundle, base)
  local folder = prefix .. "-hot\\"
  local text = "local require = ... return function(...) \n" .. bundle .. " end\n"
  assert(#text < 200000, "the fixture bundle fits one payload file")
  local hash = files.checksum("bundle\n" .. text)
  local index = "bundle\n" .. hash .. " bundle\n"
  local state = files.checksum(index)
  local result = { state = state, hash = hash, payloads = {} }
  result.payloads[folder .. key(state) .. "-0.pld"] = index .. "\n" .. #text .. " bundle\n\n" .. text
  if base == nil then
    result.manifest = version .. " " .. state .. " 1 - 0"
  else
    local carried = base.hash == hash and "\n" or (#text .. " bundle\n\n" .. text)
    result.payloads[folder .. key(state) .. "-" .. key(base.state) .. "-0.pld"] = index .. "\n" .. carried
    result.manifest = version .. " " .. state .. " 1 " .. base.state .. " 1"
  end
  result.manifestName = folder .. "manifest-" .. version .. ".pld"
  return result
end

return files
