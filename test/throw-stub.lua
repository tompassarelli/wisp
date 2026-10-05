-- Lua is the foreign VM boundary: run an uninstrumented bundle the way
-- Warcraft does, without the debug library, and print each report's message.
debug = nil
local module = assert(loadfile(assert(arg[1])))()
local written = {}
function GetLocalPlayer() return 0 end
function GetPlayerId(player) return player end
function DisplayTextToPlayer() end
function PreloadGenClear() written = {} end
function PreloadGenStart() end
function Preload(text) written[#written + 1] = text end
function PreloadGenEnd() print(table.concat(written, "\n")) end
module.run()
