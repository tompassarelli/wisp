# Native payoff

`bun wisp native payoff [--since YYYY-MM-DD] [--evidence DIR]... [--json]`
measures how far Wisp has come toward its direction, verifying maps without
waiting on Warcraft III: how often the native runs agree with Wisp's
headless verdicts, what those runs cost in native client minutes, and which
native checks could retire to Wisp alone.

It reads, without writing anything, every `batch.json` (a pad batch) and
`report.json` (an `accept` report) under Wisp's state folder
(`$XDG_STATE_HOME/wisp`), the checkout's `evidence/` and `builds/`, and each
`--evidence DIR` a game retains its native evidence in. Symlinks are not
followed and headless sessions are skipped.

## What it prints

The first line is the summary, one line a dashboard can show as it is:

```text
Wisp payoff: 2/2 agree · 6.7 native client-min* · 0 retire · 0 fix · savings unknown
```

Below it:

- One row per UTC Monday week and run kind (`pad/NAME` for a pad script's
  folder, or its file name when the folder is `pads`; `accept/ID` for an
  accept check): runs, native client minutes, completed comparisons and
  their agreements, disagreements, and invalid native attempts. `--since`
  drops runs before that UTC date.
- The weekly trend: native client minutes, commits on Wisp's `main`, and
  the native minutes a retirement would save by sampling one run in ten.
- **Retire**: kinds with at least ten agreeing comparisons and no
  disagreement over the last 14 days, whatever `--since` says. They would run
  on Wisp only, with a native sample chosen by the sampler in the JSON
  (`sha256-first-u32be-mod10-v1`).
- **Fix**: kinds with a completed disagreement, and the evidence files that
  hold it.

A pad run counts `2 × (game + reset + reload + run) / 60` client minutes and
agrees when its verdict is `PASS` after a completed headless comparison. An
accept report's elapsed time is split equally across its checks, an
estimate. A pad batch is dated by its file's modification time.

When a folder or file cannot be read, the scan is incomplete: nothing
retires and no saving is projected, and the notes say so.

`--json` prints the whole report: families with their match rule and window,
the sampler, per-kind weeks, the weekly trend, every file read and every run.

## In a dashboard

North's fleet digest shows a project's status line from the command its
orchestration entry declares; Wisp's declares this command, whose first line
is the summary.

## JSON contract

`schema_version` is 1. `families[]` comes from the whole rolling 14-day
window even with `--since`. Each has `id`, `match_rule: {kind, values}`,
`verdict` (`wisp-only` or `native`), `native_sample_rate` (0.1 or 1.0),
`counts`, and inclusive `window_start_unix` and `window_end_unix`.
`parent-directory` matches an immediate POSIX dirname in `values` and a
`.pad` file name; `exact-path` matches a whole path in `values`; `none`
belongs to accept checks, not scripts. An unknown or ambiguous match runs
native. Script paths are repo-relative POSIX strings: absolute paths,
backslashes and dot segments are refused.

Sampler `sha256-first-u32be-mod10-v1` hashes the UTF-8 of
`scriptPath + "\n" + fullSourceRevision`, with no trailing newline, reads the
first four SHA-256 bytes as an unsigned big-endian integer and takes it
modulo 10; a run goes native when its verdict is `native` or its bucket is 0.
The JSON `sampler` carries the identity, the exact input and a test vector,
so identical reruns draw the same sample and `--since` never changes routing.
The command files no issue and sends no message; the Fix evidence paths are
what an issue or a planner hand-off cites.
