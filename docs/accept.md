# Native acceptance in one run: `wisp accept`

Time on the signed-in Warcraft III clients is the scarcest resource a map
has. `wisp accept` turns "start a match, type a command, take a picture, read
the log" for each open issue into one batched run: the game declares each
check as data next to the issue it closes, and `accept` runs every selected
check in as few fresh matches as their maps allow, keeps each check's
evidence in a private folder and prints one verdict per check.

```text
evidence: ~/.local/state/smashcraft/accept/20261006-213501
session 1/3: effects (shared), 15 checks
NEEDS-LOOK 82-effects-12  smashcraft#82 box 2  look: a flash at stage centre, chest height  .../82-effects-12
...
FAIL       73-load  smashcraft#73 box 2  War3Log every client /^model creation failed/ since session <= 0: a 326 (first: ...)  .../73-load
17 checks: 1 pass, 1 fail, 15 needs-look
```

`accept --dry-run` prints the same plan, every step, capture and rule,
without touching a client. `--only ID...` runs some checks (an id, or a
prefix ending in `*`, such as `82-*`); `--out DIR` names the evidence folder.
A run with a failed check exits 1.

## Declaring checks

A suite (`AcceptSuite`, wisp:scripts/wisp/accept.ts) names its map
profiles, its checks and any frame measurements. A check is:

| Field | Meaning |
| --- | --- |
| `id`, `closes` | The check's name and the issue box it answers, such as `smashcraft#82 box 2`. |
| `map`, `session` | The map profile whose fresh match it runs in. Checks of one map share a match unless they name different sessions. |
| `setup` | Steps on the clients: `{ chat }` (a chat command such as `-dev effects 12`), `{ keys }`, `{ waitMs }`, and `{ receipt }`, which waits for a receipt line written since the check began. |
| `capture` | `frames` (a region, a count and an interval; saved as PPM), `reading` (text read from a region, such as an overlay; with `pattern`, its first group, as a number when it reads as one) and `measure` (one frame measured by a suite function). Every check also keeps each client's new receipt lines and War3Log lines. |
| `pass` | Rules: `receipt` and `log` (lines matching a pattern, counted per client, with `min`/`max`; a `log` rule can count `since: "session"`, which covers the map's load) and `reading` (a number within bounds, or text matching a pattern). |
| `look` | What the owner looks for in the captures. A check with it is needs-look once its rules hold. |

A rule with `orLook: true` makes the check needs-look instead of fail when it
doesn't hold: for readings of the screen, which can miss. Steps and captures
default to the first client (the host); `receipt` and `log` rules without a
`client` must hold on every client. `wisp accept` refuses a suite with
duplicate ids, unknown maps, clients or measures, bad patterns, or a rule
reading something no capture takes.

## How a run goes

Before each session the driver prepares the clients (wisp client doctor, or by
default: none crashed or disconnected by `wisp client watch`), marks each client's
receipts and War3Log, starts the session's map with the game's own
fresh-match command and waits until `watch` reports every client in the
match. Without a ClientWatch service the live driver skips both watch steps
and the game's start alone decides that the match runs. For each check it marks again, runs the setup, takes the captures in
order, collects the receipt and log lines written since its marks, and
judges the rules. A session that can't start fails each of its checks with
the reason and every client's watched state; the run goes on to the next
session.

Each run's folder (mode 0700) holds `report.txt` and `report.json`, and one
folder per check with its frames, readings, `receipts-CLIENT.txt`,
`war3log-CLIENT.txt` and `check.json` (the declaration, rules and verdict).

## Sharding over several client sets

A game that has more than one set of clients (Wisp's offline LAN pool pairs)
passes `shards` to `makeAccept`. When a run's arguments select two or more
shards (Smashcraft: `--pairs N` or `--pair K` repeated), `accept` plans the
sessions, splits them over the shards (`shardSessions`: heaviest session onto
the lightest shard, weighing a fresh match as four checks), runs the
consumer's `prepare` once (a shared map build) and every shard's `run` at
once. Each shard writes its own report into `shard-NAME/`; the run's
`report.txt` and `report.json` merge them in the plan's check order, and a
check whose shard wrote nothing fails with that shard's error. `--dry-run`
prints each shard's share before the plan.

## Composing it

```ts
import { makeAccept } from "wisp/scripts/wisp/commands/accept";
import { liveAcceptDriver } from "wisp/scripts/wisp/acceptLive";

const accept = makeAccept({
  suite,                       // the game's declared checks
  evidenceRoot: "/private/path/accept",
  clients: ["a", "b"],
  driver: liveAcceptDriver({
    start: (map, session) => freshMatchOf(map), // the game's fresh match for a map profile
    receipt: (name) => name.startsWith("mygame-dev-"),
  }).pipe(Layer.provide(/* Clients, GameFiles, ClientWatch layers */)),
});
```

`AcceptDriver` is the only service that touches clients, so tests run a suite
against a fake driver (wisp:test/accept.test.ts).

Not automated: visual judgement beyond the declared rules. A capture whose
meaning needs eyes is needs-look, with its cropped frames on disk.

## JSON Lines

`accept --json` writes one result per check, then a summary. Every object has
`schema: 1`, `command`, and `type`. Results carry `ok`, `id`, `verdict`,
`reason`, `evidence`, `rules`, `readings`, and `files`. A failed check adds
`kind: "check-fail"`, `frame`, `client`, and `message`; frame and client are
null when the check has no single frame or client. The summary has `ok`,
`counts` (results, failures, passed, needsLook), `elapsedMs`, and `evidence`.
With `--dry-run`, results are planned sessions and no clients are touched.
