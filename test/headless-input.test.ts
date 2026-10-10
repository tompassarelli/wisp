import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linePreloadFile } from "../scripts/wisp/preloadRecord";
import { installHeadless } from "../scripts/wisp/headless";
import { customMapData, writtenPreloadFile } from "../scripts/wisp/headlessInput";
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

const seenBy = (client: { run(body: () => void): void }) => {
  let text: string | undefined;
  client.run(() => {
    text = globalThis.__fixtureSeen;
  });
  return text;
};

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
      TimerStart(CreateTimer(), 1 / 60, true, trampoline("fixture.frame"));
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
