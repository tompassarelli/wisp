const PHASE = 1357;

let frame = 0;
let sink = 0;

function allocate(this: void): void {
  const names: string[] = [];
  for (let call = 0; call < 200; call++) {
    names.push(`k${frame * 200 + call}`);
    for (let spin = 0; spin < PHASE - 1357; spin++) sink += spin;
    CreateTimer();
    I2S(frame * 200 + call);
  }
  for (let spin = 0; spin < 300; spin++) sink += spin;
  frame++;
}

export function install(this: void): void {}

export function start(this: void): void {
  TimerStart(CreateTimer(), 1 / 60, true, allocate);
}
