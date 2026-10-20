export interface FrameSectionTimes {
  clock: ((this: void) => number) | undefined;
  readonly started: number[];
  readonly totals: number[];
}

let active: FrameSectionTimes | undefined;

export function attachFrameSections(times: FrameSectionTimes): void {
  active = times;
}

export function beginFrameSection(section: number): void {
  const times = active;
  if (times === undefined) return;
  const clock = times.clock;
  if (clock !== undefined) times.started[section] = clock();
}

export function endFrameSection(section: number): void {
  const times = active;
  if (times === undefined) return;
  const clock = times.clock;
  if (clock !== undefined) times.totals[section] = (times.totals[section] ?? 0) + clock() - (times.started[section] ?? 0);
}
