import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "../scripts/wisp/headless";
import { SHADOW_CONFIGS, SHADOW_JOURNEY } from "./shadow-strike94/configs";
import { SHADOW_HEADLESS } from "./shadow-strike94/headless-config";
import { NATIVE_ROWS } from "./shadow-strike94/native-rows";
import { install, start } from "./shadow-strike94/main";

const runtime = installHeadless(SHADOW_HEADLESS);
afterAll(runtime.restore);

test("[native #94] Shadow Strike initial damage and exclusive-duration ticks match all nine Classic rows per client", () => {
  const clients = runtime.clients({ install, start });
  clients.start();
  clients.frames(SHADOW_JOURNEY.frames);
  expect(clients.firstDivergence()).toBeUndefined();
  for (const client of clients.clients) {
    expect(client.errors).toEqual([]);
    expect(client.missingNatives).toEqual([]);
    for (let index = 0; index < SHADOW_CONFIGS.length; index++) expect(client.files.get(`shadow-strike94-${SHADOW_CONFIGS[index]?.name}-p${client.slot}.txt`)).toEqual(NATIVE_ROWS[index]);
  }
});
