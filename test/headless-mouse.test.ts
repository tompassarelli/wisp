import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../host/headless/headless";
import { type Journey, runJourney } from "../src/headless/journey";
import { MEASURED_BATTLE_NET, syncDelivery } from "../src/headless/syncChannel";
import { install, start } from "./player-mouse67/main";
import { EXPECTED } from "./player-mouse67/expected";
import { PLAYER_MOUSE_JOURNEY } from "./player-mouse67/journey";

const runtime = installHeadless({ filePrefix: "mouse", globalPrefixes: ["__mouse"] });
afterAll(runtime.restore);

const CARD_PIXELS = 200;

test("[scenario] journey mouse events drag a chip across cards on the dragging player's client only", () => {
  const chips = new Map<number, { card: number; carried: boolean; path: number[] }>();
  const map = { install: () => {}, start: () => {
    const chip = { card: 0, carried: false, path: [] as number[] };
    chips.set(GetPlayerId(GetLocalPlayer()), chip);
    TimerStart(CreateTimer(), 1 / 60, true, () => {
      const card = Math.floor(BlzGetMouseScreenPosX() / CARD_PIXELS);
      const held = BlzIsMouseButtonPressed(MOUSE_BUTTON_TYPE_LEFT);
      if (held && !chip.carried && card === chip.card) chip.carried = true;
      if (chip.carried && chip.path[chip.path.length - 1] !== card) chip.path.push(card);
      if (!held && chip.carried) {
        chip.carried = false;
        chip.card = card;
      }
    });
  } };
  const drag: Journey = { frames: 40, events: [
    { frame: 5, player: 0, mouse: { x: 50, y: 300 } },
    { frame: 10, player: 0, mouse: { x: 60, y: 300, left: true } },
    { frame: 15, player: 0, mouse: { x: 250, y: 300 } },
    { frame: 20, player: 0, mouse: { x: 450, y: 310 } },
    { frame: 25, player: 0, mouse: { x: 460, y: 310, left: false } },
  ] };
  const result = runJourney(runtime.clients(map, [0, 1]), drag);
  expect(result.clients.map(client => client.errors)).toEqual([[], []]);
  expect(result.divergence).toBeUndefined();
  expect(chips.get(0)).toEqual({ card: 2, carried: false, path: [0, 1, 2] });
  expect(chips.get(1)).toEqual({ card: 0, carried: false, path: [] });
});

test("[scenario] one player's synchronized mouse move, down and up reach every client's player-event triggers on the same frame with the same world point and button", () => {
  const clients = runtime.clients({ install, start }, [0, 1], { delivery: syncDelivery(MEASURED_BATTLE_NET) });
  const result = runJourney(clients, PLAYER_MOUSE_JOURNEY);
  expect(result.divergence).toBeUndefined();
  expect(result.clients.map(client => [...client.errors, ...client.missingNatives.map(missing => missing.native)])).toEqual([[], []]);
  for (const client of clients.clients) expect(client.files.get(`player-mouse-p${client.slot}.txt`)).toEqual(EXPECTED);
});
