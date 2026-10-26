import type { Journey } from "../../src/headless/journey";

export const PLAYER_MOUSE_JOURNEY: Journey = { frames: 40, events: [
  { frame: 5, player: 1, playerMouse: { x: 512.25, y: -1024.5 } },
  { frame: 8, player: 0, playerMouse: { x: 100.125, y: 200.75 } },
  { frame: 10, player: 0, playerMouse: { x: 100.125, y: 200.75, button: "left", down: true } },
  { frame: 12, player: 1, playerMouse: { x: -333.375, y: 47.5, button: "right", down: true } },
  { frame: 15, player: 0, playerMouse: { x: 1234.5, y: -0.25, button: "left", down: false } },
] };
