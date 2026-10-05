// Input from outside a headless client: text a player's keyboard types, clicks
// on the frames they see, a CustomMapData folder another program reads and
// writes, and clients run in real time for a program that types into them.
import { afterAll, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linePreloadFile } from "../scripts/wisp/boundary";
import { installHeadless } from "../scripts/wisp/headless";
import { RealtimeClients, customMapData, typedFile, writtenPreloadFile } from "../scripts/wisp/headlessInput";
import { installDispatch, on, trampoline } from "../src/platform/dispatch";
import { readChunk, writeLines } from "../src/platform/fileio";
import { configureRuntime } from "../src/runtime/config";

declare global {
  var __fixtureBox: framehandle | undefined;
  var __fixtureSeen: string | undefined;
}

const runtime = installHeadless({
  filePrefix: "fixture",
  globalPrefixes: ["__fixture"],
  localNatives: {
    BlzFrameSetFocus: "gives this client's keyboard to a frame",
    BlzFrameSetVisible: "shows a frame on this client",
    BlzFrameSetText: "shows text on this client",
    BlzFrameGetText: "reads this client's text",
  },
});
afterAll(runtime.restore);

const folder = mkdtempSync(join(tmpdir(), "wisp-headless-input-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const seen = (text: string) => {
  globalThis.__fixtureSeen = `${globalThis.__fixtureSeen ?? ""}${text} `;
};

/** A map with an edit box that player 0's client focuses, and a trigger noting every W key player 1 presses. */
const editBoxMap = {
  start: () => {
    configureRuntime({ filePrefix: "fixture", readyPrefix: "FX_HRR", globalPrefix: "__fixture" });
    installDispatch();
    const box = BlzCreateFrameByType("EDITBOX", "Box", BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0), "", 0);
    BlzFrameSetTextSizeLimit(box, 12);
    if (GetLocalPlayer() === Player(0)) BlzFrameSetFocus(box, true);
    globalThis.__fixtureBox = box;
    const keys = CreateTrigger();
    BlzTriggerRegisterPlayerKeyEvent(keys, Player(1), ConvertOsKeyType(0x57), 0, true);
    on("fixture.key", () => seen(`${GetPlayerId(GetTriggerPlayer())}:${BlzGetTriggerPlayerKey()}`));
    TriggerAddAction(keys, trampoline("fixture.key"));
  },
  install: () => {},
};

const boxText = (client: { run(body: () => void): void }) => {
  let text = "";
  client.run(() => {
    text = BlzFrameGetText(globalThis.__fixtureBox ?? BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0));
  });
  return text;
};

const seenBy = (client: { run(body: () => void): void }) => {
  let text: string | undefined;
  client.run(() => {
    text = globalThis.__fixtureSeen;
  });
  return text;
};

test("typed text reaches the typist's focused edit box, up to its limit; without one, each letter is a key press every client sees", () => {
  const clients = runtime.clients(editBoxMap);
  clients.start();
  clients.type(0, "@J1abc;");
  clients.type(0, "@J1defghij;");
  expect(clients.clients.map(boxText)).toEqual(["@J1abc;@J1de", ""]);
  clients.type(1, "w");
  expect(clients.clients.map(seenBy)).toEqual(["1:87 ", "1:87 "]);
  expect(() => clients.type(1, "@")).toThrow('no key types "@" outside an edit box');
  expect(clients.firstDivergence()).toBeUndefined();
});

test("a click reaches the highest shown frame under it on the clicker's client, and every client runs its handler with the clicker", () => {
  const clients = runtime.clients({
    start: () => {
      configureRuntime({ filePrefix: "fixture", readyPrefix: "FX_HRR", globalPrefix: "__fixture" });
      installDispatch();
      const ui = BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0);
      const clicks = CreateTrigger();
      const button = (name: string, level: number) => {
        const frame = BlzCreateFrame("ScriptDialogButton", ui, 0, 0);
        BlzFrameSetAbsPoint(frame, FRAMEPOINT_TOPLEFT, 0.125, 0.5);
        BlzFrameSetSize(frame, 0.25, 0.125);
        BlzFrameSetLevel(frame, level);
        BlzFrameSetText(frame, name);
        BlzTriggerRegisterFrameEvent(clicks, frame, FRAMEEVENT_CONTROL_CLICK);
        return frame;
      };
      button("under", 1);
      const over = button("over", 2);
      if (GetLocalPlayer() === Player(1)) BlzFrameSetVisible(over, false);
      on("fixture.click", () => seen(`${GetPlayerId(GetTriggerPlayer())}:${BlzFrameGetText(BlzGetTriggerFrame())}`));
      TriggerAddAction(clicks, trampoline("fixture.click"));
    },
    install: () => {},
  });
  clients.start();
  expect(clients.click(0, 0.25, 0.4375)).toBe(true);
  expect(clients.click(1, 0.25, 0.4375)).toBe(true);
  expect(clients.click(0, 0.5, 0.4375)).toBe(false);
  expect(clients.clients.map(seenBy)).toEqual(["0:over 1:under ", "0:over 1:under "]);
  expect(clients.client(0).frames.shownText()).toEqual(["under", "over"]);
  expect(clients.client(1).frames.shownText()).toEqual(["under"]);
});

test("a client's CustomMapData folder: the map's files are there as Warcraft writes them, and Preloader reads what another program writes", () => {
  const data = join(folder, "data");
  const clients = runtime.clients({
    start: () => {
      configureRuntime({ filePrefix: "fixture", readyPrefix: "FX_HRR", globalPrefix: "__fixture" });
      installDispatch();
      writeLines(`fixture-out-p${GetPlayerId(GetLocalPlayer())}.txt`, ["hello", "world"]);
      on("fixture.frame", () => {
        const chunk = readChunk("fixture-in.pld");
        if (chunk !== undefined) seen(chunk);
      });
      TimerStart(CreateTimer(), 0.0, true, trampoline("fixture.frame"));
    },
    install: () => {},
  }, [0, 1], { files: (slot) => (slot === 0 ? customMapData(data) : undefined) });
  clients.start();
  expect(readFileSync(join(data, "fixture-out-p0.txt"), "utf8")).toBe(writtenPreloadFile(["hello", "world"]));
  expect(writtenPreloadFile(["hello"])).toBe("function PreloadFiles takes nothing returns nothing\n\r\n\tcall PreloadStart()\r\n\tcall Preload( \"hello\" )\r\n\tcall PreloadEnd( 0.0 )\r\n\nendfunction\n\n\r\n");
  clients.frames(1);
  writeFileSync(join(data, "fixture-in.pld"), linePreloadFile("Q"));
  clients.frames(1);
  expect(clients.clients.map(seenBy)).toEqual(["Q ", undefined]);
});

test("in real time, a program's typed lines reach the client before the next frame; a held client stops every client and its text waits", () => {
  const typed = join(folder, "typed-0.txt");
  const input = typedFile(typed);
  let now = 1000;
  const realtime = new RealtimeClients(runtime.clients(editBoxMap), new Map([[0, input]]), () => now);
  realtime.start();
  now += 50;
  realtime.advance();
  expect(realtime.clients.frame).toBe(3);
  appendFileSync(typed, "abc\nde");
  now += 17;
  expect(realtime.advance()).toBeCloseTo(1000 / 60 * 5 - 67);
  expect(realtime.clients.frame).toBe(4);
  expect(boxText(realtime.clients.client(0))).toBe("abc");
  realtime.hold(0);
  appendFileSync(typed, "f\n");
  now += 250;
  realtime.advance();
  expect(realtime.clients.frame).toBe(4);
  expect(boxText(realtime.clients.client(0))).toBe("abc");
  realtime.release(0);
  now += 17;
  realtime.advance();
  expect(realtime.clients.frame).toBe(5);
  expect(boxText(realtime.clients.client(0))).toBe("abcdef");
  input.close();
});
