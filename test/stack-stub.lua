-- Lua is the foreign VM boundary: verify its varargs and protected unwinding
-- against the emitted TypeScript, with Warcraft's absent debug library.
debug = nil
local module = assert(loadfile(assert(arg[1])))()
local written = {}
function GetLocalPlayer() return 0 end
function GetPlayerId(player) return player end
function DisplayTextToPlayer() end
function PreloadGenClear() written = {} end
function PreloadGenStart() end
function Preload(text) written[#written + 1] = text end
function PreloadGenEnd() end
module.fail()
assert(__waygateStack.depth == 0, "failed callback leaked frames")
print(table.concat(written, "\n"))
assert(module.normal(4) == 11, "ordinary return changed")
assert(__waygateStack.depth == 0, "ordinary return leaked frames")
local packed = table.pack(module.forwarded())
assert(packed.n == 4 and packed[1] == 7 and packed[2] == nil and packed[3] == "third" and packed[4] == nil, "multiple returns changed")
assert(select("#", module.empty()) == 0, "void return changed")
assert(module.caught() == 23, "caught return changed")
assert(module.identity(), "thrown Error identity changed")
assert(__waygateStack.depth == 0, "caught failure leaked frames")
local finally = module.captureFinally()
assert(finally:find("in deepest", 1, true) and finally:find("in nested", 1, true), "finally discarded original frames")
assert(__waygateStack.depth == 0, "finally failure leaked frames")
local after = module.afterCatch()
assert(after:find("in nextFailure", 1, true), "later failure missing")
assert(not after:find("in deepest", 1, true), "caught frames leaked into later failure")
assert(__waygateStack.depth == 0, "second failure leaked frames")
print("stack and unwind contract passed")
