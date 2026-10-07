# Desync autopsy

When a native session desyncs, Wisp names the cause on its own. A session
runner prints one line such as

```text
desync autopsy: first divergent birth #6279 CScriptFunc at turn 921 on client a
```

and saves every input in an evidence folder. Nobody has to collect logs, start
a poller or compare files.

## Guardrails

This is for developing your own maps on your own development clients. It is
not for cheating, and not for touching other players' games or accounts. It
opens game processes only through [`wisp engine`'s guardrails](engine.md#guardrails):

- It follows only the clients the project's clients file declares, never a game
  on the owner's display `:0`.
- It only reads. The poller reads `/proc/PID/mem` read-only from outside the
  game, which is allowed on a development client signed in to Battle.net. The
  autopsy never sets breakpoints, attaches a debugger, writes to a game or
  injects code.
- When the machine doesn't allow the read, it prints one line naming
  `kernel.yama.ptrace_scope` and goes on without the poller. Wisp never
  changes the setting.

## Where it runs

Every native session runner runs inside it:

- `wisp doctor` and `wisp watch` (not `watch --once`).
- Every run wrapped by `withDoctor(check, print, run, { autopsy: { clientsFile } })`
  (wisp:scripts/wisp/doctor.ts). Smashcraft's native pad runs, integrity and
  bot captures, `fresh` and `accept` all go through it.

`wisp play` doesn't pass `autopsy`, because it is the owner's own game. Other
code wraps any Effect with `withAutopsy({ clientsFile }, run)`
(wisp:scripts/wisp/engine/autopsy.ts).

## What a session does

1. **The presence poller.** At the start the session reads
   `kernel.yama.ptrace_scope`. At `0`, or when this process launched the
   client (an ancestor may read it at `1`), it starts `wisp engine`'s
   [presence poller](engine.md) on every declared client in its own thread, so
   timed input such as pad scripts keeps its timing. It prints one line saying
   which clients it reads and where the logs go. Otherwise it prints one line
   naming the sysctl and continues without it. The poller retries a client
   that isn't running yet every 2 s.
2. **Report watch.** Each client's `Documents/Warcraft III/Errors` folder is
   listed at the start. Every 500 ms the session looks for new report folders
   holding a `Desync.txt` or `*_Desync.log`. It skips crash reports and waits
   until the game has finished writing.
3. **Autopsy.** The clients write their reports of a desync within moments of
   each other. The session takes one report per client within 10 s, waiting up
   to 3 s for a missing partner. Then it:
   - compares the two `*_Desync.log`s (`wisp engine desync`);
   - takes the first turn where they differ;
   - if Tempest's presence table (`ipse`) differs there, takes each client's
     next birth tag. The client that is ahead made birth `min(A, B)` earlier
     than the other;
   - looks that birth up in the client's poll log. It uses the last time that
     number was born before the report was written, because birth numbers
     start again in each game;
   - names its class. That is the handle object that owns the agent when the
     poller found one (`CScriptFunc` for a code callback, a timer), otherwise
     the agent's own class.
4. **Report.** It prints the finding when it finds it, then the Lua/TypeScript
   stack when a stack source recorded one, then the evidence folder. At the end
   it prints a summary of every finding. A failure inside the autopsy is printed
   and never fails the session.

Other findings the line can report:

- **No poller.** `first divergent birth #N (class unknown: ...) at turn T on
  client X`. The birth, turn and client still come from the Desync.logs.
- **Same births, different free-list heads.** An agent was freed on a
  different turn.
- **Another section differed first,** such as `rand`. The cause is not a
  handle.

## Evidence

Each session gets `$XDG_STATE_HOME/wisp/autopsy/<UTC time>/`, which holds:

- `presence/<client>.log`: the session's poll logs. The format is in
  wisp:scripts/wisp/engine/presenceLog.ts.
- `desync-N/` for each desync:
  - `autopsy.txt`: the finding, the full `wisp engine desync` comparison and
    the `wisp engine diff` of the two poll logs;
  - `<client>/`: that client's `Desync.txt`, `*_Desync.log`, `War3Log.txt` and
    `presence.log`.

## The presence poller

The class of a birth comes only from a poll that was running before the
desync. The table is in memory, and the game frees what it reveals. Without the
poller, run the next session with memory reads allowed: set
`kernel.yama.ptrace_scope=0` for the debugging session with the owner's
agreement, or launch the clients from a Wisp process. Then reproduce. On
Smashcraft #158, about half of integrity brawl starts desynced.

## Tests

wisp:test/autopsy.test.ts replays #158's recorded desync of turn 921. It uses
both clients' `Desync.log` (wisp:test/fixtures/engine/) and `Desync.txt`, and
both clients' presence polls over two games (wisp:test/fixtures/autopsy/,
converted from the #158 poller's recording). The tests check:

- the CScriptFunc birth on client a;
- the finding without a poll;
- the choice between two games' copies of a birth number;
- a `rand` desync;
- report discovery and pairing;
- the one-line sysctl refusal;
- a wrapped session that finds a desync written while it runs.
