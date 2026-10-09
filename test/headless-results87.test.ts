import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";

const runtime = installHeadless({ filePrefix: "results87", globalPrefixes: [], playerNames: { 0: "Medivh", 1: "Jaina" } });
afterAll(runtime.restore);

test("[spec #87] results read configured names, changed camera target and nonlooping thematic music", () => {
  const clients = runtime.clients({ install: () => {}, start: () => {
    SetCameraPosition(120, 240);
    DisplayTextToForce(GetPlayersAll(), `${GetPlayerName(Player(0))}/${GetPlayerName(Player(1))}:${GetCameraTargetPositionX()}`);
    SetCameraPosition(-640, 80);
    DisplayTextToForce(GetPlayersAll(), `${GetCameraTargetPositionX()}`);
    SetMusicVolume(64);
    PlayMusic("Stage.ogg");
    PlayThematicMusic("Results.ogg");
    SetMusicVolume(0);
    StopMusic(false);
  } });
  clients.start();
  expect(clients.firstDivergence()).toBeUndefined();
  for (const client of clients.clients) {
    expect(client.missingNatives).toEqual([]);
    expect(client.messages).toEqual(["Medivh/Jaina:120", "-640"]);
    expect(client.cameraPose().x).toBe(-640);
    expect(client.soundLog.map(cue => [cue.event, cue.source, cue.looping, cue.volume])).toEqual([
      ["start", "Stage.ogg", true, 64], ["stop", "Stage.ogg", true, 64],
      ["start", "Results.ogg", false, 64], ["volume", "Results.ogg", false, 0], ["stop", "Results.ogg", false, 0],
    ]);
  }
});
