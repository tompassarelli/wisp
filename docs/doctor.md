# Clients that heal themselves: `wisp client doctor`

A signed-in Warcraft III client breaks in a handful of known ways: it drops
from Battle.net, its login closes to an empty Options/Exit Game shell, it
crashes with its error dialog up, it sits in a lobby or on a loading screen
from an earlier run, or a second Wine runtime starts on its prefix. Each has a
known recovery. `wisp client doctor [CLIENT...]` finds which state each client of the
clients file is in (all of them, or those named) and runs that state's
recovery, printing each step. A launcher at its Battle.net sign-in form is
signed in with the client's declared account. It stops with one plain line
only when a person is needed: a state it doesn't know, or a sign-in form
with no account declared.

```text
a: ready: menus (MAIN_MENU)
b: disconnected: Battle.net connection lost (socket: ...); ending Warcraft III
b: ending Warcraft III (pids 52713)
b: Battle.net started Warcraft III (pid 70001)
b: Warcraft III signing in...
b: ready: menus (MAIN_MENU), after disconnected, no game
```

```text
b: closed: neither Battle.net nor Warcraft III runs; starting Battle.net
b: Battle.net started
b: Battle.net signing in...
b: sign-in form: Battle.net shows its password page; signing in with its account
b: typing its password
b: Battle.net signed in
b: no game: Battle.net is signed in; Warcraft III isn't running; asking Battle.net to launch Warcraft III
```

Run it before a session on the clients; `play`, `accept` and the bot
sessions run it for you (below). It exits 1 when it stopped.

Clients marked `offline: true` in the clients file belong to the LAN pool.
They need no Battle.net start declaration. Doctor reads their watch state
without starting or ending programs or sending input. A closed, crashed or
disconnected client stops with a line asking its pool owner to restart that
pair. Other states are reported to the session runner, which starts its match
through `lan fresh`. This applies per client, including mixed clients files;
signed-in clients still require their own Battle.net start declaration.

## What it reads

Nothing from the screen. Each client's state comes from
[`wisp client watch`](../scripts/wisp/watch.ts) (wisp:scripts/wisp/watch.ts): the
menus' socket, Warcraft III's own log, the map's receipts and the processes.
Doctor adds the client's Wine prefix:

- **Processes.** The prefix's wineservers, Battle.net's main process,
  Warcraft III.exe and the crash reporter `_retail_\x86_64\BlizzardError.exe`,
  which holds Warcraft's error dialog up after a crash. A prefix's processes
  are found as `play` finds them ([play.md](play.md), step 1).
- **The launcher's newest log** (`AppData/Local/Battle.net/Logs/battle.net-*.log`)
  written since the running launcher started: a prefix copied from another
  install carries that install's logs ([lan.md](lan.md), cloned clients).
  Signed in is `Logged into Battle.net successfully`. After the last sign-in,
  `ERROR_TOKEN_NOT_FOUND` means Battle.net rejected the saved login: only the
  account's owner can sign in again. A failed Warcraft III sign-in token
  (`GenerateAuth`), or presence updates timing out (`ERROR_RPC_REQUEST_TIMED_OUT`)
  at least twice to the log's end, means the launcher lost its connection
  (client B, 3 Oct: every 46 s once its VPN address went away), which a
  restarted launcher reconnects
  (smashcraft:docs/warcraft-authentication.md).
  Its sign-in form is read from its `[UnifiedAuth]` lines: `finished loading.
  statusCode=200 state=Login` is the account page, `state=LoginCredential`
  the password page, and `status changed: RequestingToken` a submitted page.

## States and recoveries

Checked in this order, so the prefix comes before the game and the game
before the launcher. Each recovery runs at most once a run: a state that
comes back after its recovery stops doctor with "still ... after ..."
instead of looping.

| State | Seen when | Recovery |
| --- | --- | --- |
| Two runtimes on one prefix | More than one wineserver uses the prefix. A launcher started beside another runtime can't start the game. | End every program of the prefix (SIGTERM, SIGKILL after 20 s), then start Battle.net alone and launch the game. |
| Runtime without Battle.net | A wineserver without Battle.net or Warcraft III, still there after 20 s. | End it, then start Battle.net. |
| Crashed with the error dialog up | BlizzardError.exe runs, or `watch` says crashed (an exited game, a new `Errors/*/Crash.txt`). | End the dialog and Warcraft III, then launch the game from the retained launcher. |
| Disconnected | `watch` says Warcraft III lost Battle.net. | End Warcraft III, check the launcher, launch the game. A dropped game isn't asked to sign in again: its Login button would open another sign-in. |
| Empty login shell | The menus report a login screen (`LOGIN_DOORS`, `LOGIN_OPTIONS`), or signing in, for 120 s (Warcraft III signed in within 14 s on 6 Oct). | End Warcraft III and launch it from the retained launcher: the observed recovery (warcraft-modding skill). |
| Map without its imports | Warcraft III's log has `model creation failed - war3mapImported/...` lines: the map loaded while its ladder scan ran ([play.md](play.md), step 4). | End Warcraft III and launch it again. |
| Stuck loading | On the loading screen for 120 s. | End Warcraft III and launch it again. |
| Display settings changed | A signed-in client's closed game's War3Preferences.txt holds other `[Video]`, `[Misc]` or `[Sound]` values than its graphics profile and declared `displaySettings` ([Graphics profiles](#graphics-profiles), [display-settings.md](display-settings.md)). | Write the expected values into the file, keeping its other lines. |
| Stale lobby | In a lobby from an earlier run. | `LeaveGame` on the menus' socket, or the Back button without a menu page. |
| Score screen | An earlier match's score screen. | Escape in its window, up to 3 presses 10 s apart, each only while the watch still shows the score screen (a key at the menus could reach Battle.net's channel); Warcraft III 3.0 ignores the menus' `ScoreScreenClose` there. Still there after the third: end Warcraft III, and the launcher starts it again at the menus. |
| Closed | Neither Battle.net nor Warcraft III runs. | Start Battle.net the way the game declares, then launch the game. |
| No game | Battle.net is signed in; Warcraft III isn't running. | Ask the launcher to launch Warcraft III; its log must take it within 15 s and report the game running within 45 s. A launch it reports failed restarts Battle.net once and asks again, as `play` does. |
| Connection failing | The launcher's log shows its connection lost (above). | Restart Battle.net (every program of the prefix), then launch the game. |
| Sign-in form | The launcher's log shows its account or password page loaded, and the client declares an account. | Sign in (below). |
| Sign-in needed | The launcher's log shows its saved login rejected, or no sign-in 90 s after it started (240 s for its sign-in form when the client declares an account: on 7 Oct client B's password page took 47 s to load under load). | Stop: one line naming the client, its display and what to do. |

A client in its menus, signed in, or in a match is ready. Signing in or
loading for less than its bound is waited on. A game no source places yet
(`running`: its process, no menu screen heard, no sign-in in its log) is
left alone when doctor finds it, and waited on for up to 120 s when doctor
just launched it.

War3Log.txt is written in bursts: on 6 Oct client B's log stopped 3 s into a
session that then signed in and played all evening, so it showed no sign-in
for hours. A client that only its log calls "signing in", with no menu page
reporting, is therefore left alone and reported, never ended.

Doctor never starts Warcraft III.exe itself (only the
launcher does, asked as `play` asks it), never starts Battle.net beside
another runtime, and
never touches a client that is ready.

## Sign in

A client that declares an account (`accounts` in the declaration, below) is
signed in at its launcher's sign-in form. On the account page doctor types
the username and Return, waits up to 30 s for the password page, then types
the password and Return and waits up to 30 s for `Logged into Battle.net
successfully`. A launcher that remembers the account name opens on the
password page and gets only the password. Each field goes into the
`Battle.net Login` window (else `Battle.net`) on the client's own display:
doctor focuses it. The account page focuses its own field, so the account
name is typed where the focus is, as nixos-config:dotfiles/bin/wc3-login-field
types it (a pointer move on the launcher window failed on the cloned clients
of 8 Oct). On the password page, which loaded with no field focused on 7 Oct,
doctor clicks the empty field where its placeholder `Password` reads and
selects any text there with ctrl+a before typing. It types only while that
window has focus, and submits only if it still has it after typing.

The account's commands print one field each on stdout. Doctor runs one only
while typing that field and pipes its bytes to `xdotool type --file -`: the
value is never an argument, a log line, a file or printed output, and its
buffer is zeroed after. A command's failure is reported by its exit code
alone. "Keep me logged in" is left as the form has it; doctor changes no
account or launcher setting.

## Sign out

`wisp client sign-out CLIENT...` ends every program of each client's prefix
(SIGTERM, SIGKILL after 20 s) and removes the launcher's saved login, the
values of `HKCU\Software\Blizzard Entertainment\Battle.net\UnifiedAuth` in
the prefix's `user.reg`, rewritten only while no Wine runtime runs there.
Its next start shows the sign-in form, which the next doctor run fills: on
7 Oct client B went from signed out to signed in that way. Use it to test a
sign-in, or before handing a client's prefix to another account.

## Graphics profiles

Each signed-in client of the clients file runs one graphics profile, named by
its entry's `profile` (wisp:scripts/wisp/lan/pool.ts `CLIENT_PROFILES`).
Doctor writes the profile's War3Preferences `[Video]`, `[Misc]` and `[Sound]`
while the game is closed, so `client start` and every session that runs doctor
first launch the client with it; the entry's `displaySettings` override its
`[Video]` keys. A running game keeps its settings until it restarts.

| Profile | Settings | For |
|---|---|---|
| `minimal` (default) | The pool's `parity`: 800×600, every quality setting lowest, Classic models, sound off, 60 fps focused or not | Functional and gameplay checks |
| `visual` | The pool's `visual`: 1280×720, Reforged, lighting high, textures medium, sound on, 60 fps | Captures where looks matter |
| `capture-classic`, `capture-reforged`, `capture-definitive` | 1280×720, named graphics mode, high lighting/shadows/point-light shadows/water, ambient occlusion on, textures medium, sound effects on, music off, 60 fps | Matched lighting and effect/audio captures on 3.0.1 |
| `player` | Tom's own settings, read from his prefix's War3Preferences.txt on 8 Oct: Reforged, lighting high, every other quality setting lowest, sound and music on; 1920×1080 (the desktop) at 60 fps focused or not | Every performance or frame-pacing measurement |

`player` starts from the owner's file rather than the game's default preset:
it is what a player of this machine actually runs. Performance and
frame-pacing runners refuse any other profile with one line
(`measurementRefusal`) and print each client's profile (`profilesLine`).

## Clients as services

A client started from a terminal or an agent's task is that process's child
and ends with it: an agent's turn ending, or its two-hour background limit,
took signed-in clients down mid-check on 8 October 2026. So a signed-in
client and its private desktop run as systemd user services, which belong to
the user's service manager and run until stopped:

```text
wisp client start [CLIENT...] --clients-file FILE
wisp client status [CLIENT...] --clients-file FILE
wisp client stop [CLIENT...] --clients-file FILE
```

- **start** gives each named client (all when none; never `offline: true`
  ones) whose `run` folder has no live desktop a new private desktop as the
  service `wisp-desktop-CLIENT`, and writes its run folder into the clients
  file. Then doctor brings each to a ready state, starting a closed client's
  Battle.net as the service `wisp-client-CLIENT`; start returns once each
  game reached its menu (or is already in a lobby or match) and prints
  status. A client already running, under any owner, is kept.
- **status** prints, per client, its desktop and its Battle.net with the
  service that runs each (and since when), or the process each would end
  with when it isn't a service, and its game's state from `client watch`.
- **doctor** first gives a named client whose desktop a `stop` ended a new
  one, as start does, so it heals a stopped client instead of failing on the
  old run folder's `display`.
- **stop** stops each named client's Battle.net service, then its desktop
  service, whatever the services are called. A client some other process
  started is left running and named.

Doctor itself starts every launch command (`start.kind: "command"`) as
`wisp-client-CLIENT`, so a client doctor restarts mid-run outlives that run
too. Each service runs its program inside the machine-capacity helper's
`session` (the desktop as `native` with `--memory-gib 1.5`, the client as
its launch command declares), so admission works as before: the helper reaches
the user's service manager from a service, which it can't from inside
`run-bounded`'s namespaces. Desktop output goes to
`~/.local/state/wisp/desktops/CLIENT.log`; a client's to its declared log.
`systemctl --user status wisp-client-CLIENT` shows the same.

On 8 October 2026 `client start clone-d` started clone-d's desktop in 1 s,
its Battle.net signed in by itself, and its game reached the main menu 3.5
minutes after the command started; the starting command had exited and the
client kept running.

### One start at a time

Clients start one at a time, and the lock enforces it: before doctor (and so
`client start`) starts a client's Battle.net or game, it takes the machine's
start lock, `~/.local/state/wisp/online/client-start.lock`, and holds it until
that client reaches its menus or doctor stops, or 300 s pass. A second start
waits, printing who holds the lock; a client already running is unaffected.
On 8 October clone-a crashed 1.8 s after clone-d's game started beside it
(wisp:scripts/wisp/startLock.ts, wisp:test/startLock.test.ts).

## Declare it

The game adds the command with `makeDoctor`
(wisp:scripts/wisp/clientDoctorCommand.ts):

```ts
export const doctor = makeDoctor({
  clientsFile: join(homedir(), ".local/state/smashcraft/clients.json"),
  // How each client's Battle.net starts: a Steam shortcut, or a command on the client's own display.
  start: {
    a: { kind: "command", command: [/* steam-run ... proton waitforexitandrun .../Battle.net Launcher.exe */], log: "/state/client-a.log" },
    b: { kind: "steam", appId: 3516115572, name: "Warcraft III B" },
  },
  // Optional: the Battle.net account each client signs in with, as commands that print one field on stdout.
  accounts: {
    b: { username: ["cat", "/run/secrets/bnet-b-username"], password: ["cat", "/run/secrets/bnet-b-password"] },
  },
}, ClientWatch.layer({ filePrefix: "smashcraft" }));
```

Each client's prefix is the folder its `documents` lives in
(`<prefix>/drive_c/users/steamuser/Documents/Warcraft III`) and its display
is its desktop run folder's. Doctor launches Warcraft III as `play` does
([play.md](play.md), step 3): Battle.net's `--exec="launch W3"` inside the
client's launcher container, never a click in its window.

## Doctor in other commands

- **Bot sessions and other runs on the clients:** `clientsDoctor(declaration,
  names, print)` runs it as a library call (with the caller's ClientWatch),
  and `withDoctor(check, print, run, { retry })`
  (wisp:scripts/wisp/doctor.ts) runs `check` (a doctor run), then `run`; when
  `run` fails it runs `check` once more and, only if that recovered
  something, `run` once more. A failure doctor can't explain stands. A run
  that can't repeat, such as a capture into its own folder, passes
  `retry: false`: its clients are healed for the next run and its failure
  stands.
- **`wisp accept`:** pass `clientsDoctor(...)` as the live driver's
  `prepare` (wisp:scripts/wisp/acceptLive.ts).
- **`wisp play`:** checks its prefix with doctor before step 1 and once after
  a failure, without launching the game itself (`DoctorHands.launches`
  false): play's own steps start Battle.net and launch it.

## Tests

wisp:test/doctor.test.ts runs every state above against a simulated client:
client B's recorded process shapes, launcher log lines recorded on 3 and 6
Oct (wisp:test/fixtures/doctor), B's burst-written War3Log and the 6 Oct
crash report. The live watch's view of each state and the launcher's
answer to a launch request are properties of the real
clients, which only a native run checks.
