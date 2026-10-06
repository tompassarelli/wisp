# Clients that heal themselves: `wisp doctor`

A signed-in Warcraft III client breaks in a handful of known ways: it drops
from Battle.net, its login closes to an empty Options/Exit Game shell, it
crashes with its error dialog up, it sits in a lobby or on a loading screen
from an earlier run, or a second Wine runtime starts on its prefix. Each has a
known recovery. `wisp doctor [CLIENT...]` finds which state each client of the
clients file is in (all of them, or those named) and runs that state's
recovery, printing each step. It stops with one plain line only when a person
is needed: a Battle.net sign-in, or a state it doesn't know.

```text
a: ready: menus (MAIN_MENU)
b: disconnected: Battle.net connection lost (socket: ...); ending Warcraft III
b: ending Warcraft III (pids 52713)
b: Play started Warcraft III (pid 70001)
b: Warcraft III signing in...
b: ready: menus (MAIN_MENU), after disconnected, no game
```

```text
b: Battle.net rejected its saved login (ERROR_TOKEN_NOT_FOUND); it needs its owner to sign in to Battle.net: sign in in its launcher on display :2 with "Keep me logged in" ticked, then run doctor again
```

Run it before a session on the clients; `play`, `accept` and the bot
sessions run it for you (below). It exits 1 when it stopped.

## What it reads

Nothing from the screen. Each client's state comes from
[`wisp watch`](../scripts/wisp/watch.ts) (wisp:scripts/wisp/watch.ts): the
menus' socket, Warcraft III's own log, the map's receipts and the processes.
Doctor adds the client's Wine prefix:

- **Processes.** The prefix's wineservers, Battle.net's main process,
  Warcraft III.exe and the crash reporter `_retail_\x86_64\BlizzardError.exe`,
  which holds Warcraft's error dialog up after a crash. A prefix's processes
  are found as `play` finds them ([play.md](play.md), step 1).
- **The launcher's newest log** (`AppData/Local/Battle.net/Logs/battle.net-*.log`).
  Signed in is `Logged into Battle.net successfully`. After the last sign-in,
  `ERROR_TOKEN_NOT_FOUND` means Battle.net rejected the saved login: only the
  account's owner can sign in again. A failed Warcraft III sign-in token
  (`GenerateAuth`), or presence updates timing out (`ERROR_RPC_REQUEST_TIMED_OUT`)
  at least twice to the log's end, means the launcher lost its connection
  (client B, 3 Oct: every 46 s once its VPN address went away), which a
  restarted launcher reconnects
  (smashcraft:docs/warcraft-authentication.md).

## States and recoveries

Checked in this order, so the prefix comes before the game and the game
before the launcher. Each recovery runs at most once a run: a state that
comes back after its recovery stops doctor with "still ... after ..."
instead of looping.

| State | Seen when | Recovery |
| --- | --- | --- |
| Two runtimes on one prefix | More than one wineserver uses the prefix. A launcher started beside another runtime can't start the game. | End every program of the prefix (SIGTERM, SIGKILL after 20 s), then start Battle.net alone and press Play. |
| Runtime without Battle.net | A wineserver without Battle.net or Warcraft III, still there after 20 s. | End it, then start Battle.net. |
| Crashed with the error dialog up | BlizzardError.exe runs, or `watch` says crashed (an exited game, a new `Errors/*/Crash.txt`). | End the dialog and Warcraft III, then press Play in the retained launcher. |
| Disconnected | `watch` says Warcraft III lost Battle.net. | End Warcraft III, check the launcher, press Play. A dropped game isn't asked to sign in again: its Login button would open another sign-in. |
| Empty login shell | The menus report a login screen (`LOGIN_DOORS`, `LOGIN_OPTIONS`), or signing in, for 120 s (Warcraft III signed in within 14 s on 6 Oct). | End Warcraft III and press Play in the retained launcher: the observed recovery (warcraft3-development skill). |
| Map without its imports | Warcraft III's log has `model creation failed - war3mapImported/...` lines: the map loaded while its ladder scan ran ([play.md](play.md), step 4). | End Warcraft III and press Play. |
| Stuck loading | On the loading screen for 120 s. | End Warcraft III and press Play. |
| Stale lobby | In a lobby from an earlier run. | `LeaveGame` on the menus' socket, or the Back button without a menu page. |
| Score screen | An earlier match's score screen. | `ScoreScreenClose` on the menus' socket, or Back. |
| Closed | Neither Battle.net nor Warcraft III runs. | Start Battle.net the way the game declares, then Play. |
| No game | Battle.net is signed in; Warcraft III isn't running. | Press Play; the launcher's log must take it within 15 s and report the game running within 45 s. A launch it reports failed restarts Battle.net once and presses Play again, as `play` does. |
| Connection failing | The launcher's log shows its connection lost (above). | Restart Battle.net (every program of the prefix), then Play. |
| Sign-in needed | The launcher's log shows its saved login rejected, or no sign-in 90 s after it started. | Stop: one line naming the client, its display and what to do. |

A client in its menus, signed in, or in a match is ready. Signing in or
loading for less than its bound is waited on.

War3Log.txt is written in bursts: on 6 Oct client B's log stopped 3 s into a
session that then signed in and played all evening, so it showed no sign-in
for hours. A client that only its log calls "signing in", with no menu page
reporting, is therefore left alone and reported, never ended.

Doctor never signs in, never starts Warcraft III.exe itself (only the
launcher's Play does), never starts Battle.net beside another runtime, and
never touches a client that is ready. Battle.net's credential entry stays with
the owner or the authorized login-field helper (warcraft3-development skill).

## Declare it

The game adds the command with `makeDoctor`
(wisp:scripts/wisp/commands/doctor.ts):

```ts
export const doctor = makeDoctor({
  clientsFile: join(homedir(), ".local/state/smashcraft/clients.json"),
  // How each client's Battle.net starts: a Steam shortcut, or a command on the client's own display.
  start: {
    a: { kind: "command", command: [/* steam-run ... proton waitforexitandrun .../Battle.net Launcher.exe */], log: "/state/client-a.log" },
    b: { kind: "steam", appId: 3516115572, name: "Warcraft III B" },
  },
  watch: ClientWatch.layer(/* wisp watch's options for these clients */),
});
```

Each client's prefix is the folder its `documents` lives in
(`<prefix>/drive_c/users/steamuser/Documents/Warcraft III`) and its display
is its desktop run folder's. On a private desktop Play is pressed in the
client's own Battle.net window: its text is read and Warcraft III's Play
found as `play` finds it (opening the Games tab and Warcraft III's tile when
the launcher shows another game), and clicked with XTEST on the client's X
display (wisp:scripts/wisp/doctorHost.ts).

## Doctor in other commands

- **Bot sessions and other runs on the clients:** `clientsDoctor(declaration,
  names, print)` runs it as a library call, and `withDoctor(targets, print,
  run)` (wisp:scripts/wisp/doctor.ts) runs doctor, then `run`; when `run`
  fails it runs doctor once more and, only if that recovered something, `run`
  once more. A failure doctor can't explain stands.
- **`wisp accept`:** pass `clientsDoctor(...)` as the live driver's
  `prepare` (wisp:scripts/wisp/acceptLive.ts).
- **`wisp play`:** checks its prefix with doctor before step 1 and once after
  a failure, without pressing Play itself (`DoctorHands.pressPlay` absent):
  play's own steps start Battle.net and press Play.

## Tests

wisp:test/doctor.test.ts runs every state above against a simulated client:
client B's recorded process shapes, launcher log lines recorded on 3 and 6
Oct (wisp:test/fixtures/doctor), B's burst-written War3Log and the 6 Oct
crash report. Whether the private desktop's Battle.net window takes the Play
click, and the live watch's view of each state, are properties of the real
clients, which only a native run checks.
