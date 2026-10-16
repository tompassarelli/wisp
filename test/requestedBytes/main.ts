const STRINGS_PER_FRAME = 256;

let frame = 0;

function allocate(this: void): void {
  const names: string[] = [];
  for (let index = 0; index < STRINGS_PER_FRAME; index++) names.push(`k${frame * STRINGS_PER_FRAME + index}`);
  frame++;
}

export function install(this: void): void {}

export function start(this: void): void {
  TimerStart(CreateTimer(), 1 / 60, true, allocate);
}
