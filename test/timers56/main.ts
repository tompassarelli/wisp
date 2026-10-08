// wisp#56's timer rules: one row per rule Smashcraft relies on
// (wisp:docs/warsmash-notes.md#timers-and-frame-stepping). Headless runs and the
// native capture map play this same code and write the same rows.
import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/platform/fileio";

/** Game seconds at which the rows are written. */
export const TIMER_RULES_SECONDS = 1.25;

export function install(this: void): void {
  configureRuntime({ filePrefix: "timers56", readyPrefix: "TM56_HRR", globalPrefix: "__timers56" });
}

/** Runs every case from the moment it is called and passes the rows to `done` after 1.25 game seconds. */
export function timerRules(this: void, done: (this: void, lines: readonly string[]) => void): void {
  const lines: string[] = [];
  const ms = (clock: timer) => R2I(TimerGetElapsed(clock) * 1000.0);
  const reference = CreateTimer();
  TimerStart(reference, 3600.0, false, () => {});

  // Zero-timeout one-shot: fires once, at the start time.
  TimerStart(CreateTimer(), 0.0, false, () => lines.push(`zero-one-shot-reads-ms=${ms(reference)}`));

  // Equal deadlines run in start order, not creation order.
  const first = CreateTimer();
  const second = CreateTimer();
  TimerStart(second, 0.5, false, () => lines.push("same-deadline=second-started-first"));
  TimerStart(first, 0.5, false, () => lines.push("same-deadline=first-created-first"));

  // Within a frame, an earlier deadline runs first even when started later.
  TimerStart(CreateTimer(), 0.5078125, false, () => lines.push("in-frame-order=later-deadline-first"));
  TimerStart(CreateTimer(), 0.50390625, false, () => lines.push("in-frame-order=earlier-deadline-first"));

  // A 1/60 s timer fires once per 1/60 s; a 1/1024 s timer catches up inside
  // each frame, 17 or 18 callbacks between two 1/60 s ticks, and each callback
  // reads its own deadline as the game time.
  let ticks = 0;
  let fast = 0;
  let fastAtTick = 0;
  let fewest = 1000000;
  let most = 0;
  TimerStart(CreateTimer(), 0.0009765625, true, () => {
    fast++;
    if (fast === 512) lines.push(`fast-512th-reads-ms=${ms(reference)}`);
  });
  TimerStart(CreateTimer(), 1.0 / 60.0, true, () => {
    ticks++;
    if (ticks > 1) {
      const between = fast - fastAtTick;
      if (between < fewest) fewest = between;
      if (between > most) most = between;
    }
    fastAtTick = fast;
  });

  // A zero period still repeats, many times a frame.
  let zero = 0;
  const zeroTimer = CreateTimer();
  TimerStart(zeroTimer, 0.0, true, () => {
    zero++;
  });

  // A periodic timer's elapsed time restarts each period; an expired
  // one-shot reads its timeout; a paused timer keeps its elapsed time.
  const periodic = CreateTimer();
  const expired = CreateTimer();
  const paused = CreateTimer();
  TimerStart(periodic, 0.5, true, () => {});
  TimerStart(expired, 0.5, false, () => {});
  TimerStart(paused, 10.0, false, () => lines.push("unexpected-paused-callback"));

  // A zero-timeout one-shot started inside a callback is timed from that
  // callback's deadline and waits 1/1024 s: it fires after one more 1/1024 s
  // callback, in the same frame.
  const deferred = CreateTimer();
  let fastAtStart = 0;
  TimerStart(CreateTimer(), 0.2421875, false, () => {
    TimerStart(deferred, 0.0, false, () => lines.push(`started-in-callback-fast-before=${fast - fastAtStart}`));
    fastAtStart = fast;
  });

  TimerStart(CreateTimer(), 0.75, false, () => {
    lines.push(`periodic-between-ms=${ms(periodic)}`);
    lines.push(`expired-after-ms=${ms(expired)}`);
    PauseTimer(paused);
    lines.push(`paused-at-pause-ms=${ms(paused)}`);
  });
  TimerStart(CreateTimer(), 1.0, false, () => {
    lines.push(`ticks-in-one-second=${ticks}`);
    lines.push(`fast-in-one-second=${fast}`);
    lines.push(`fast-between-ticks=${fewest}..${most}`);
    lines.push(`zero-period-in-one-second=${zero}`);
  });
  TimerStart(CreateTimer(), TIMER_RULES_SECONDS, false, () => {
    lines.push(`paused-later-ms=${ms(paused)}`);
    lines.push(`periodic-after-ms=${ms(periodic)}`);
    PauseTimer(zeroTimer);
    DestroyTimer(zeroTimer);
    done(lines);
  });
}

export function start(this: void): void {
  install();
  timerRules(lines => writeLines(`timers56-p${GetPlayerId(GetLocalPlayer())}.txt`, lines));
}
