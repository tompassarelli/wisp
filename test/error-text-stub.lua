-- The Lua VM is Warcraft's irreducible foreign boundary. This fixture drives
-- the emitted error reporter with native stubs that record what is displayed
-- and what is written to the error file.
local bundleFile = assert(io.open(assert(arg[1]), "rb"))
local payload = bundleFile:read("a")
bundleFile:close()
local shown, writes, preload = {}, {}, {}
function GetLocalPlayer() return 0 end
function GetPlayerId(p) return p end
function PreloadGenClear() preload = {} end
function PreloadGenStart() end
function Preload(text) preload[#preload + 1] = text end
function PreloadGenEnd(name) writes[name] = table.concat(preload, "\n") end
function DisplayTextToPlayer(p, x, y, text) shown[#shown + 1] = text end
local module = assert(load(payload))()
module.install()
module.fail("first")
assert(#shown == 1 and shown[1] == "error in fixture.tick: first", "a default configuration did not show the report")
assert(writes["fixture-error-p0.txt"] == "error 1 in fixture.tick\nfirst")
module.showErrors(false)
module.fail("second")
assert(#shown == 1, "a report was displayed after the map turned error text off")
assert(writes["fixture-error-p0.txt"] == "error 2 in fixture.tick\nsecond", "a report that is not displayed was not written")
module.showErrors(true)
module.fail("third")
assert(#shown == 2 and shown[2] == "error in fixture.tick: third", "turning error text back on did not show the report")
assert(writes["fixture-error-p0.txt"] == "error 3 in fixture.tick\nthird")
print("error text contract passed")
