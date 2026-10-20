const TABLES_PER_FRAME = 50;

let sink: object | undefined;
let total = 0;

function tables(this: void): void {
  for (let index = 0; index < TABLES_PER_FRAME; index++) sink = {};
}

function idle(this: void): void {
  for (let index = 0; index < 200; index++) total = total + index * 2;
}

function tick(this: void): void {
  tables();
  idle();
}

export function install(this: void): void {}

export function start(this: void): void {
  TimerStart(CreateTimer(), 1 / 60, true, tick);
}
