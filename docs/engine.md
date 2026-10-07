# Engine debugging

`wisp engine` is a read-only debugger into Warcraft III's engine for network
desyncs. It compares the state dumps clients write on a desync, follows each
client's Tempest presence table as agents are born and freed, and records the
game's own call stack at every birth.

## Why these tools exist

Smashcraft #158 shows the cost of debugging this class of bug without them.
The match-start desync was a handle made at a per-client moment. Native
experiments that changed one variable at a time took about 3.5 hours on
7 Oct 2026, from 06:40 to 10:00. They ruled out 10 mechanisms over about 45
two-client runs, and a commit bisect pointed at a red herring. With the
read-only presence poller and a perf hardware breakpoint, the engine lane went
from launch to the exact call site in about 30 minutes: the `TimerStart`
closure at trace.ts:150 made a `CScriptFunc` birth. The fix was confirmed in
8 of 8 clean runs. Evidence: smashcraft#158 and
smashcraft:docs/warcraft-api-netcode-findings.md. We keep and extend these
tools because they cut this class of bug from hours to minutes.

## Guardrails

These tools are for debugging your own map on your own development clients.
They are not for cheating, and not for touching other players' games or
accounts. wisp:scripts/wisp/engine/attach.ts is the only way they open a game
process, and it enforces these rules:

- It attaches only to clients the project's clients file declares, matched by
  Wine prefix. It takes only processes of the current user, never an
  arbitrary process ID, and never a game on the owner's display `:0`, because
  a `wisp play` session can share a development client's prefix.
- **Reads, online-OK** (`poll`, `locate`, the [Lua VM reader](#lua-stacks)) open `/proc/PID/mem` read-only. They are
  passive and run outside the process, so they may follow a development client
  that is signed in to Battle.net.
- **Traps, offline only** (`watch`, `locate --watch`) set a perf hardware breakpoint, which
  loads the thread's debug registers. `watch --lua` also stops the writing
  thread at each birth with ptrace (wisp:scripts/wisp/engine/stopWatch.ts). Traps refuse unless the client is
  verifiably offline. That means its network namespace has only loopback
  (`/proc/PID/net/dev` lists only `lo`), it has no Battle.net session
  argument (`-uid`), no Battle.net program runs in its prefix, and it holds
  no TCP connection or connected UDP socket to an address outside this
  machine. An offline client also passes `-launch`, so that flag proves
  nothing.
- Nothing writes to a game process or injects code, and nothing stops or
  traces a client that isn't verifiably offline. No command offers any of these.

Why two tiers: anti-cheat that runs inside the game can only notice what it
can observe from inside. That covers debug registers, a traced or stopped
state, and modified memory. An external read of `/proc/PID/mem` leaves none of
these behind. A `gdb` attach (ptrace) made signed-in client A exit with
code 1 about 4 s later (#158), so ptrace is a trap: offline clients only.

A command tries the read first. Yama's default `kernel.yama.ptrace_scope=1`
still allows it in three cases: from an ancestor, at scope 0, or into a user
namespace this user owns. Proton's pressure-vessel runs the game in such a
namespace, so reads usually just work. When a read fails, the command
refuses and prints the exact commands to change the scope. The owner decides
the setting; Wisp never changes it.

```text
sudo sysctl kernel.yama.ptrace_scope=0   # for the debugging session only
sudo sysctl kernel.yama.ptrace_scope=1   # restore afterwards
```

`watch` also needs `kernel.perf_event_paranoid` at 2 or lower, which is the
usual default. It uses `perf` from PATH, `--perf BIN`, or `nix build nixpkgs#perf`.

## Commands

A project composes the command with `makeEngine(clientsFile)`
(wisp:scripts/wisp/commands/engine.ts), passing the same clients file that
`wisp watch` reads. Smashcraft runs it as `bun wisp engine ...`.

| Command | What it does |
| --- | --- |
| `wisp engine desync A B [--turn N]` | Compares two clients' `*_Desync.log`. It prints the first differing turn and section, each differing record, and Tempest's `ipse` table decoded per turn. A and B may be log files, report folders, Errors folders or Documents/Warcraft III folders; a folder means its newest report. |
| `wisp engine poll --client a,b [--seconds N] [--interval MS] [--out DIR]` | Follows each client's presence table every 2 ms and writes `DIR/<client>.log` with one line per agent born or freed. Each line carries the agent's class from RTTI and, for a `CAgentBaseAbs`, the class of the handle that owns it. |
| `wisp engine diff A.log B.log [--skew S] [--limit N] [--source-maps DIR]` | Aligns two poll logs by birth number. It prints births one client has and the other lacks, the first class difference, and births whose time between clients differs from the median by more than S seconds (0.1 by default). With the map's source maps, a code callback's `at map-KEY:LINE` becomes its TypeScript line. |
| `wisp engine diff ACTIONS.log POLL.log [--class REGEX] [--turn-ms MS]` | Places each birth of a poll log in the turn of a LAN host's action log it fell in, with the last actions delivered before it ([Actions](#actions)). |
| `wisp engine actions --client lan0a,lan0b [--map MAP] [--follow]` | Prints what Warcraft's network layer delivered to an offline pool pair, turn by turn: each player's orders, BlzSendSyncData payloads with their prefixes, key and frame events, chat, joins, loads, leaves, and every desync by turn ([Actions](#actions)). |
| `wisp engine watch --client a [--seconds N] [--depth N] [--out DIR]` | Sets a hardware write breakpoint on the birth counter and records the game's stack for every birth. Frames are named by known role. It writes `DIR/<client>.stacks.txt` and prints the most common stacks. Offline clients only. |
| `wisp engine watch --client a --lua [--seconds N] [--limit N] [--source-maps DIR]` | Stops the game's main thread at every birth with a ptrace debug-register watchpoint, reads the Lua VM's exact call stack while the thread is stopped, then lets it go. It writes `DIR/<client>.lua-stacks.txt` with one line per birth, in the form `birth N CLASS owner CLASS: TimerStart <- FILE.ts:LINE <- FILE.ts:LINE`. Offline clients only, and the build needs `lua` chains in the offsets file. |
| `wisp engine locate --client a [--watch SECONDS] [--span BYTES]` | Finds the presence table in a running client of any build and checks the offsets file's entry for it, or prints a new entry. With `--watch`, it also names the tag allocator and release from their writes (offline only). |

Logs go under `$XDG_STATE_HOME/wisp/engine/<UTC time>/` unless you pass `--out`.
Session runners use the same modules: `startPresencePoll` and `pollPresence`
(wisp:scripts/wisp/engine/poll.ts), `compareDesyncLogs` and `compareDumps`
(wisp:scripts/wisp/engine/desyncLog.ts), and `parsePresenceLog` and
`diffPresenceLogs` (wisp:scripts/wisp/engine/presenceLog.ts).

## Actions

The per-turn action stream comes from the LAN host, not from memory. Offline
pool clients ([lan.md](lan.md)) play against Wisp's own host, which relays
every turn and so sees every action every client sent. It decodes them into
the game's action log, `pair-K/games/<time>/actions.log`, and compares
each client's state checksum for every turn. `wisp engine actions --client
lan0a,lan0b` prints the pair's current log; `--follow` keeps printing until
the game ends, and `--map MAP` starts a match first. Only the pool's own
clients are accepted: a client signed in to Battle.net has no action log here,
and no tool reads its network traffic.

To see what each action caused in the engine, run `wisp engine poll` on the
pair (`WISP_CLIENTS=~/.local/state/wisp/lan/clients.json`) while the match
runs, then `wisp engine diff ACTIONS.log POLL/<client>.log`. Both logs name
their start time, so each birth lands in its turn:

```
256.614 birth 4281 CAgentBaseAbs owner CPlayerChatMatchEventData in turn 4470; 2 turns after turn 4468: lan0b chat trigger=10a3:10a3 text="-dev quick"; ...
```

The log format and how the host builds it are in [lan.md](lan.md#the-action-log).

## Debugging a desync

Native session runners do the steps below on their own: see the
[desync autopsy](autopsy.md) (wisp:docs/autopsy.md). Follow them by hand for a
desync that happened outside a session.

1. `wisp engine desync` on the two clients' Documents folders names the
   section. If `ipse` is the only one, a client made or freed an agent (a
   handle, a timer, a code callback) on a different turn. The signature is
   births ±1 with free head ±1, or births ±2 with free head ±4.
2. Reproduce with `wisp engine poll --client a,b` running, then run
   `wisp engine diff` on its two logs. The birth that stands out names the
   class and owner, for example `CAgentBaseAbs owner CScriptFunc`, which is a
   code callback.
3. On offline clients, `wisp engine watch --client a` gives that birth's
   stack in the game's code.

Real output for #158's turn-921 desync (paths shortened):

```text
A .../client-a/.../WHITERABBIT_100726_025200_Desync.log: dump 1 of 1, desync turn 921
B .../client-b/.../WHITERABBIT_100626_224821_Desync.log: dump 32 of 32, desync turn 921
first difference: turn 921, section ipse
sections that differ on any dumped turn: ipse
  turn 921 ipse: checksum A 192239296 B 192236288
    #1: A 0x000016F7 B 0x000016F8
    #2: A 0x00001888 B 0x00001887
ipse (Tempest presence table): free head = next presence tag, births = next birth tag
  turn  client  free head  births  records
  920   A       5880       6279    #0 0x0000862E #3 0x014A4298
  920   B       5880       6279    #0 0x0000862E #3 0x014A4298
  921   A       5879       6280    #0 0x00008647 #3 0x014A4298
  921   B       5880       6279    #0 0x00008647 #3 0x014A4298
  turn 921: births B-A -1, free head B-A +1
only Tempest's presence table differs: one client made or freed an agent (a handle, a code callback) on a different turn.
```

## How it works

**Desync.log.** On a desync, each client appends the last three turns of
every checksum section to `Errors/<report>/<host>_<session>_Desync.log`. The
file accumulates across a session's games, so a long session holds many
dumps. Every block has the form `[Desync - SECTION - Turn(N) = CHECKSUM]`.
SECTION is a FourCC in decimal: `ipse` is Tempest, and the others include
`rand`, `cnet` and `cust`. Below the header come tab-indented `#ID#: 0xVALUE`
records; a record without a value opens a group, and the same ID with a
value closes it. A dump starts at `ipse`. `desync` pairs the newest dumps of
the same desync turn, then compares blocks by section, repeat and turn. In
`ipse`, record `#1` is the free-list head ("next presence tag") and `#2` is
the birth counter ("next birth tag").

**The presence table.** Every agent registers in Tempest's presence table. An
agent is a `CAgentBaseAbs` owned by a Jass/Lua handle, or an Ipse object such
as `NIpse::CPoFlag`. In 3.0.0.24268 the table is a pointer at image RVA
`0x2f80770`. It has 16-byte entries at `+0x18`, each holding the next free
index (or -2 when live) and the agent. Their count is at `+0x30`, the free
head at `+0x70` and the birth counter at `+0x80`. An agent holds its tag at
`+0x20`, its birth at `+0x24` and its owning handle at `+0x90`. The poller
reads the table's header on every poll. When the header changes, it reads
every entry and compares them with the previous read: a new agent in a slot is
a birth, and a slot that went free is a free. Class names come from MSVC x64
RTTI: vtable[-1] points to the complete object locator, whose type descriptor
holds a name such as `.?AVCPoFlag@NIpse@@`.

**The image.** Wine maps the executable twice. The image base is the mapping at
file offset 0 whose PE header matches the executable on disk; the other is a
whole-image alias. `.text` is encrypted on disk and decrypted page by page as
it first runs, so the code that matters is readable in a live client. The
headers, `.rsrc` (the file version that selects the offsets) and `.pdata` (the
function table that names frames) are plain on disk.

**Stacks.** `watch` runs
`perf record -e mem:ADDR/4:w -p PID --call-graph dwarf,4096`. Each write to
the birth counter is one sample, holding the instruction pointer and 4 KiB of
user stack. The game has no symbols or frame pointers, so frames are the
qwords on the stack that point into `.text` just after a call instruction in
the client's decrypted code. `.pdata` gives each frame's function start, and
the offsets file's `roles` names the known ones. In 24268, a birth's stack
starts with `tag allocator+0xe7 < fn 0x19b550+0x1f5 < CAgentBaseAbs allocator+0x78`.

## Lua stacks

Warcraft III embeds Lua 5.3.4, built with 32-bit integers and floats.
wisp:scripts/wisp/engine/lua.ts reads it with Lua's x64 structure offsets:

- the lua_State's `ci` chain, back to its base CallInfo;
- each Lua frame's closure, Proto, chunk name and current line, which is
  `lineinfo[savedpc - code - 1]`;
- each C frame's function, named from `_G` (the registry's array slot 2),
  where Warcraft's natives such as `TimerStart` are C functions.

A Wisp map's chunk names are `map-KEY` and `hot-KEY`, the same keys its
source maps are kept under, so any position maps to a TypeScript line.

Two routes find the code behind a birth:
- **Closure provenance (read tier).** A code callback's agent points to its
  `CScriptFunc`, which holds the Lua closure. The poller logs where that
  function was defined (`owner CScriptFunc at map-KEY:LINE`). This works on
  any development client, because nothing is stopped.
- **Exact stack (trap tier).** By the time anything reads memory after a perf
  sample, the Lua VM has moved on, since `savedpc` lives on the heap and not on
  the C stack. `watch --lua` therefore stops the writing thread
  (wisp:scripts/wisp/engine/stopWatch.ts: ptrace seize, DR0/DR7, and DR6 to
  tell its own SIGTRAP from the game's) and reads the stack before it resumes.
  Bun's FFI calls libc's ptrace and waitpid; no helper program is needed.

The offsets file's optional `lua` entry holds the two pointer chains:
`state`, from the image base to the map's main lua_State, and `closure`,
from a `CScriptFunc` to its closure.

## A new Warcraft build

Offsets live in one data file, wisp:scripts/wisp/engine/offsets.json, keyed by
the executable's file version (for example `3.0.0.24268`). A build with no
entry makes live commands stop with that message. To add one:

1. On a running client of the new build, run
   `wisp engine locate --client a`. It scans the first 64 MiB of `.data` for a
   pointer to a table in the known layout whose sampled live agents hold their
   own tag, then prints the entry. Add `--watch 3` on an offline client to also
   name the tag allocator and release from the writes to the birth counter and
   free head.
2. Copy the entry into offsets.json. Copy any `roles` that are still valid
   only after checking them with `watch` stacks.
3. If `locate` finds nothing, the table's own layout moved. Re-derive it by hand:
   - Dump a client's decrypted image (its pages through `/proc/PID/mem`).
   - Find `War3 next presence tag %05d next birth tag %05d` in `.rdata` and
     the code that formats it (the Desync.txt assertion builder, 24268 RVA
     `0x1524220`). Its loads give the table pointer and the head and birth
     offsets.
   - Confirm the layout with a `poll` against `Desync.txt`'s values.
   Keep decrypted dumps and decompiler output in private storage outside
   every repository.
