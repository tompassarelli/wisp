import type { Journey } from "../../src/headless/journey";

export const PLAYER_MOUSE_REPORT_SECONDS = 0.5;

export const PLAYER_MOUSE_JOURNEY: Journey = { frames: 40, events: [
  { frame: 10, player: 1, playerMouse: { x: 1234.5, y: -987.25 } },
  { frame: 12, player: 1, playerMouse: { x: 1240.75, y: -980, button: "right", down: true } },
  { frame: 15, player: 1, playerMouse: { x: -512.25, y: 64.5, button: "right", down: false } },
] };
