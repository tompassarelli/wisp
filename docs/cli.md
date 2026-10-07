# Command vocabulary

Wisp's commands and the programs games compose from them (Smashcraft's
`bun wisp`, the sample map's program) share one vocabulary, so a new
capability lands as a verb or flag people already know instead of another
bespoke command:

```text
PROGRAM NOUN [VERB] [OBJECT...] [--flag VALUE ...]
```

`bun wisp client wait b "in match" --seconds 60` reads as: on the clients,
wait for client `b` to be in a match, for at most 60 seconds.

## Rules

1. **Noun first.** A top-level name is the thing a command acts on (`map`,
   `client`, `engine`); what it does to it is the verb after it
   (`map rebuild`, `client watch`, `engine diff`). A noun with a single
   operation takes no verb (`repro FILE`, `soak`).
2. **Sessions.** A few top-level names run one whole session and take no
   verb: `dev`, `hot`, `tune`, `fresh`, `play`, `controller`, `accept`,
   `soak`. They are named for the session they run.
3. **A new operation is a verb** under the noun it acts on, never a mode
   flag and never a new top-level name. Flags change how a verb runs.
4. **Several objects are several arguments**: `client watch a b`,
   `pad SCRIPT...`. No `--batch` or `--all` flags.
5. **One meaning per flag spelling**, in every noun and program, as the
   [flags](#flags) table gives it. A singular flag selects or sets a value
   and may repeat (`--client a --client b`, or `--client a,b`); a plural flag
   with a number is a count (`--clients 4`, `--pairs 2`).
6. **Shared verbs** keep one meaning too: `build` and `rebuild` make a map;
   `capture` runs a native session into an evidence folder and `result`
   reconciles that folder; `compare` and `diff` set two runs side by side;
   `host`, `join`, `start` and `leave` are lobby steps; `install`, `remove`
   and `setup` change a Warcraft III installation; `wait` blocks until a
   state; `watch` follows passive state until stopped; `trace` traps, stops
   or breakpoints a process and therefore runs only on offline clients.
7. **A new top-level noun** is allowed only when no noun below owns the thing
   it acts on, it names a thing (or is a session under rule 2), and the same
   change adds its row to the [nouns](#nouns) table. Prefer a verb under an
   existing noun.
8. **No aliases.** A rename migrates every in-tree consumer in the same
   change; current `main` is the supported line.

Where commands are listed: Wisp's command factories need a row in the
[feature index](index.md) (wisp:docs/index.md) and their verbs on the
command's own page; Smashcraft's `bun wisp` commands need a line in
smashcraft:AGENTS.md.

## Nouns

"Wisp" means the command factory ships in wisp:scripts/wisp/commands/ and any
program can register it; "game" means the consuming game defines it.

| Noun | What it acts on | Verbs | Defined by |
| --- | --- | --- | --- |
| `inputs` | Private build inputs | `add`, `check`, `path` | game |
| `map` | The game's Warcraft III map file | `build`, `rebuild` | Wisp services, game command |
| `dev` | The every-save development session | (session) | Wisp |
| `hot` | Hot reload into running clients | (session) | Wisp |
| `tune` | Live tuning of declared values | (session) | Wisp |
| `fresh` | A new match in every client | (session) | game |
| `play` | The owner's desktop to a match | (session) | Wisp |
| `controller` | The always-on controller service | (session) | game |
| `accept` | The game's declared native checks | (session) | Wisp |
| `client` | One native client: its screen, input, state and recovery | `look`, `read`, `click`, `keys`, `chat`, `wait`, `watch`, `doctor` | Wisp |
| `menus` | Warcraft III's menus through Wisp's menu page | `install`, `remove`, `listen`, `host`, `join`, `start`, `leave` | Wisp |
| `online` | Direct play over Battle.net by join code | `setup`, `host`, `join` | game |
| `lan` | The offline LAN client pool | `setup`, `pool`, `fresh`, `status`, `end` | Wisp |
| `engine` | Warcraft III's engine inside a client, for desyncs and offline scripted runs | `desync`, `poll`, `diff`, `trace`, `locate`, `actions`, `drive` | Wisp |
| `headless` | A journey in simulated clients | (journey name) | Wisp |
| `soak` | Many headless matches by computers and a fuzzed controller | (session) | Wisp |
| `perf` | Predicted frame cost | (run name), `compare`, `native`, `fit`, `budget`, `profile`, `census` | Wisp |
| `repro` | A saved moment of play | (file) | Wisp |
| `replay` | A full-match replay | (file) | game |
| `parity` | Bun against 32-bit Lua on the same numbers | `numeric`, `tapes` | game |
| `integrity` | Native input-integrity sessions and their evidence | `capture`, `result`, `headless` | game |
| `pad` | Scripted virtual-pad input through the real helper | (script) | game |
| `farm` | Headless work on hosted CI runners | `balance`, `pads`, `perf`, `memory` | game |
| `view` | What a player would see, and the model facts it reads | `scene`, `frame`, `models`, `strikes`, `reach`, `hurtboxes`, `motion` | game |
| `oracle` | Melee situations against decompiled values | (session) | game |
| `agency` | Stretches a victim can't act in | (session) | game |
| `interactions` | The fighters' interaction graph | (session) | game |

## Flags

Every flag a command's usage line shows is declared here with its one meaning.

| Flag | Meaning | Used by |
| --- | --- | --- |
| `--client NAME` | A native client by its name in the clients file; repeatable or `a,b` | `engine`, `online`, `lan` |
| `--clients N` | How many simulated clients | `headless` |
| `--pairs N` | How many client pairs | `lan`, `pad` |
| `--data DIR` | A running client's CustomMapData folder, once per client | `dev`, `hot`, `tune` |
| `--profile NAME` | The map's build profile (`main`, `integrity`, `playable`, `physics-probe`, `frame-cost`, `stack-trace`) | `map`, `fresh`, `hot`, `tune`, `accept` |
| `--map MAP.w3x` | A built map the command plays or hosts, when the map isn't its object | `pad`, `menus host` |
| `--map-folder DIR` | The game's folder under Warcraft III's Maps | `fresh` |
| `--folder DIR` | The Create Game folder that holds the map | `menus host` |
| `--ref REF` | The Git revision measured | `farm` |
| `--out PATH` | Where the command writes its result, a file or folder as its usage says | many |
| `--helper BINARY` | The controller helper that plays input | `integrity`, `pad`, `soak` |
| `--build BUILD` | The build under test, recorded in the result | `pad` |
| `--base BASE.w3m` | The base map a build starts from | `map build` |
| `--container MAP.w3x` | The map whose contents a build keeps | `map build` |
| `--assets DIR` | The game's private asset folder | `map build`, `view` |
| `--summon DIR` | The game's private summon folder | `map build`, `view` |
| `--packager PATH` | A map packager to use instead of building one | `map build` |
| `--extractor PATH` | The CASC extractor | `view models` |
| `--storage DIR` | A Warcraft III installation to read game data from | `view models` |
| `--name NAME` | The name of what the command creates: the map's title, the hosted game's | `map build`, `menus host` |
| `--password TEXT` | A hosted game's password | `menus host`, `menus join` |
| `--start` | Start the game once hosted | `menus host` |
| `--port N` | A local TCP port | `tune`, `menus` |
| `--rebuild` | Replace the map's script first | `fresh` |
| `--no-quick` | Don't send the quick-match chat command | `fresh` |
| `--watch` | Keep running and act on every save | `hot` |
| `--wait` | Block until a remote run ends, then print its verdict | `farm` |
| `--once` | Print the current state and exit | `client watch` |
| `--json` | One JSON object a line | `client watch`, `headless`, `soak`, `repro`, `accept`, `perf` |
| `--record FILE` | Also append every event to a file | `client watch` |
| `--seconds N` | A time limit in seconds | `client wait`, `soak` |
| `--minutes N` | A time limit in minutes | `soak` |
| `--dry-run` | Print the plan without touching clients | `accept` |
| `--only ID` | Only these checks; repeatable | `accept` |
| `--repair` | Reinstall the menu page first | `online` |
| `--app-id SLOT=ID` | A client's private desktop window, per slot | `pad` |
| `--chat TEXT` | A chat command typed before the script runs | `pad` |
| `--retries N` | How many times an invalid run reruns | `pad` |
| `--headless` | Play into headless clients instead of native ones | `pad` |
| `--compare DIR` | A native run's folder to hold the headless run to | `pad` |
| `--repro FILE` | Play a soak finding again | `soak` |
| `--test NAME` | Write a test with this name | `repro` |
| `--view` | Open a saved moment with a frame slider and client field differences | `repro` |
| `--shrink` | Remove inputs while keeping the same failure kind | `repro` |
| `--no-shrink` | Keep new soak repros without shrinking | `soak` |
| `--check` | Compare against what this checkout last wrote | `interactions` |
| `--move FIGHTER:MOVE` | One move to evaluate | `interactions` |
| `--attacker NAME` | Only this attacking fighter; repeatable | `agency` |
| `--starter NAME` | Only this starter | `agency` |
| `--fighter NAME` | Only this fighter; repeatable | `soak` |
| `--stage NAME` | Only this stage; repeatable | `soak` |
| `--policy NAME` | Only this computer policy; repeatable | `soak` |
| `--seed N` | The first random seed | `soak` |
| `--seeds N` | How many seeds | `farm` |
| `--matches N` | How many matches | `soak` |
| `--workers N` | How many worker processes | `soak` |
| `--level N` | The computer players' level | `farm` |
| `--opponent ID` | The computer players' named opponent identity | `farm balance` |
| `--tier TIER` | The computer players' difficulty tier | `farm balance` |
| `--per-pair N` | How many matches each fighter pair plays | `farm` |
| `--frames N` | How many frames to play | `perf` |
| `--samples` | Also print each frame's sample | `perf` |
| `--threshold SHARE` | The rise that fails a comparison | `perf compare` |
| `--cost` | Also print predicted Warcraft cost per frame | `headless` |
| `--pool-profile NAME` | Offline pool display settings: parity, visual or hfr | `lan pool` |
| `--fps N` | The foreground and background frame cap for native pool clients | `lan pool` |
| `--trace SECONDS` | Trap an offline process for this many seconds | `engine locate` |
| `--clients-file FILE` | The native clients configuration file | `integrity capture` |
| `--four-fighters` | Capture the four-fighter match and rematch | `integrity capture` |
| `--playable` | Capture a playable candidate match and rematch | `integrity capture` |
| `--screen` | Capture native framebuffer samples on the stimulus clock | `integrity capture` |
| `--count N` | How many samples to capture | `integrity capture --screen` |
| `--region X,Y,WIDTH,HEIGHT` | The pixel rectangle to capture | `integrity capture --screen` |
| `--functions` | Report functions in the worst frames | `perf census` |
| `--frame N` | Inspect this recorded frame | `repro` |
| `--diff-frame N\|previous` | Compare the inspected frame with this other frame | `repro` |
| `--from INSTALL` | The installation copied to create offline clients | `lan setup` |
| `--pair K` | Select a numbered client pair; repeatable | `lan, pad` |
| `--headless-jobs N` | Number of simultaneous headless comparisons | `pad` |
| `--fresh-each` | Start a fresh game for each script when measuring startup cost | `pad` |
| `--p99 MS` | The 99th-percentile frame cost limit | `perf budget` |
| `--worst-frames N` | How many worst frames to report | `perf profile` |
| `--worst MS` | The worst-frame cost limit | `perf budget` |
| `--rise-ms MS` | The permitted rise above the standing frame baseline | `perf census` |
| `--jobs N` | Number of worker jobs | `perf census` |

## Inventory

Every command and verb in Wisp's sample program and Smashcraft's `bun wisp`, grouped by noun.

| Command | What it does |
| --- | --- |
| `map build` | Builds the TypeScript map from a base map, assets and declaration |
| `map rebuild MAP.w3x` | Replaces only a built map's script |
| `dev` | Every save's type errors, affected tests, journeys and whole check |
| `hot --data DIR... [--watch]` | Hot-reloads saves into running clients |
| `tune --data DIR...` | Panel that changes declared values in a running match |
| `fresh MAP.w3x` | New match in every client, waits for each receipt |
| `play` | Owner's desktop to a match against a computer |
| `controller` | Points the always-on controller service at main's helper |
| `accept` | Runs the declared native checks in as few matches as possible |
| `client look CLIENT` | Screenshot of one client |
| `client read CLIENT` | Reads one client's screen text |
| `client click CLIENT X Y` | Clicks in one client |
| `client keys CLIENT KEYS` | Types keys into one client |
| `client chat CLIENT TEXT` | Sends a chat message or chat command |
| `client wait CLIENT STATE...` | Waits until a client reaches a state |
| `client watch [CLIENT...]` | Each client's state from its events; `--once` prints it once |
| `client doctor [CLIENT...]` | Brings clients to a ready state |
| `menus install\|remove RETAIL_DIR` | Installs or removes Wisp's menu page |
| `menus listen` | Prints menu requests while you act by hand |
| `menus host\|join\|start\|leave` | Lobby steps through the menu page |
| `online setup` | Menu page and Allow Local Files on a player's install |
| `online host` | Hosts a private game, prints its join code |
| `online join CODE` | Joins a game by code |
| `lan pool --pairs N` | Pairs of offline throwaway clients on LAN |
| `engine desync A B` | First differing turn and section of two Desync.logs |
| `engine poll --client a,b` | Follows births and frees in each client's presence table |
| `engine diff A.log B.log` | Aligns two clients' births |
| `engine trace --client a` | Game stack at each birth (traps; offline clients only) |
| `engine locate --client a` | Finds the presence table after a Warcraft update; `--trace` traps |
| `headless [JOURNEY]` | A journey in simulated clients: desyncs, errors, scene problems |
| `soak` | Hundreds of headless matches; a repro file per finding |
| `perf [RUN]` | Predicted Warcraft cost per frame in 32-bit Lua |
| `perf compare A B` | Fails on a rise in predicted cost |
| `perf native READINGS` | Holds the prediction to native overlay readings |
| `perf fit` | Fits the cost model to native readings |
| `repro FILE` | Replays a saved moment to its recorded checksum |
| `replay FILE` | Replays a full match in Bun and 32-bit Lua |
| `parity numeric` | Numeric corpus in Bun and both 32-bit Luas |
| `parity tapes` | Replay tapes across Bun and both 32-bit Luas |
| `integrity capture` | Native input-integrity session (two fighters, `--four-fighters`, or `--playable`) |
| `integrity result DIR` | Reconciles a capture folder by the session it records |
| `integrity headless` | The same session through the real helper into headless clients |
| `pad SCRIPT...` | Timed virtual-pad input through the real helpers |
| `farm balance` | The balance gate's computer field on hosted runners |
| `farm pads` | Every pad script headless on hosted runners |
| `view scene DATA_DIR...` | What a player would see wrong in recorded scenes |
| `view frame FRAME.ppm...` | The same from captured frames |
| `view models` | Rewrites the model facts the checks read |
| `view strikes` | Rewrites hero strike moments |
| `view reach --assets DIR` | Rewrites how far swings draw |
| `view hurtboxes --assets DIR --out DIR` | Side-view sheets of every fighter's hurt volumes |
| `oracle` | Melee situations beside decompiled values |
| `agency` | Stretches a victim can't act in, per starter |
| `interactions` | Writes the interaction graph; `--check`, `--move` |
| `inputs add FAMILY PATH`, `inputs check`, `inputs path` | Registers and resolves private build inputs |
| `lan setup`, `lan fresh`, `lan status`, `lan end` | Creates, starts, reads and ends offline matches |
| `engine actions` | Reads the LAN host turn log |
| `engine drive SCRIPT --client a,b` | Delivers a numbered command file through the opted-in map's synchronized driver; `pause`, `step N`, `resume FRAME`, and `status` use the same entry |
| `perf budget`, `perf profile`, `perf census` | Checks frame budgets and reports costly functions |
| `soak memory` | Measures retained match state after warm-up |
| `farm perf`, `farm memory` | Runs frame measurements and memory soak on hosted runners |
| `view motion` | Measures fighter movement and recovery animation cadence |

For `headless`, `soak`, `repro`, `accept`, and `perf`, JSON Lines objects have
`schema: 1`, `command`, and `type` (`result`, `failure`, or `summary`). A final
summary carries `ok`, `counts`, and `elapsedMs`. Failure results carry `kind`
(desync, error, scene, check-fail, or budget), `frame`, `client`, and `message`;
frame/client are null when unavailable. `repro` and `source` (TypeScript
file:line) appear when known. Command pages describe their result fields.
