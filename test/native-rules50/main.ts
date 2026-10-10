import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/platform/fileio";
import { unitStateCases } from "../unit-states/cases";

export function install(this: void): void {
  configureRuntime({ filePrefix: "native-rules50", readyPrefix: "NR50_HRR", globalPrefix: "__nativeRules50" });
}

export function timerCases(this: void, done: (this: void, lines: readonly string[]) => void): void {
  const lines: string[] = [];
  const first = CreateTimer();
  const second = CreateTimer();
  const periodic = CreateTimer();
  const expired = CreateTimer();
  const paused = CreateTimer();
  const sample = (name: string, clock: timer) => lines.push(`${name}=${R2I(TimerGetElapsed(clock) * 1000.0)}`);
  TimerStart(second, 0.5, false, () => lines.push("same-deadline=second-started-first"));
  TimerStart(first, 0.5, false, () => lines.push("same-deadline=first-created-first"));
  TimerStart(periodic, 0.5, true, () => sample("periodic-in-callback", periodic));
  TimerStart(expired, 0.5, false, () => sample("expired-in-callback", expired));
  TimerStart(paused, 10.0, false, () => lines.push("unexpected-paused-callback"));
  TimerStart(CreateTimer(), 0.75, false, () => {
    sample("periodic-between", periodic);
    sample("expired-after", expired);
    PauseTimer(paused);
    sample("paused-at-pause", paused);
  });
  TimerStart(CreateTimer(), 1.25, false, () => {
    sample("periodic-after-second", periodic);
    sample("expired-later", expired);
    sample("paused-later", paused);
    PauseTimer(periodic);
    for (const clock of [first, second, periodic, expired, paused]) DestroyTimer(clock);
    done(lines);
  });
}

export function start(this: void): void {
  install();
  writeLines(`unit-states-p${GetPlayerId(GetLocalPlayer())}.txt`, unitStateCases());
  timerCases(lines => writeLines(`native-rules50-p${GetPlayerId(GetLocalPlayer())}.txt`, lines));
}
