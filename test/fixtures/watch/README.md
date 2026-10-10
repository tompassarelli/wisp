Recorded on 6 Oct 2026 unless noted (abridged, CRLF as Warcraft III wrote it):

- `errors/2026-10-06 13.30.33 f80136c8/`: the crash report of the `play --menus` run whose log is `../war3log/menus-listing-during-scan.txt` (Crash.txt up to its exception summary; the head of the War3Log.txt copy).
- `host-match.jsonl`: not recorded. Menu socket messages in the order a hosted match produces them, built from the message names Wisp's menu driving waits for (wisp:scripts/wisp/menus.ts) and the screen names the game's menus use. Replace it with a trace `wisp client watch --record FILE` writes.
