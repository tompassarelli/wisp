import { expect, test } from "bun:test";
import { Effect } from "effect";
import { BUILD_COMMANDS, buildProfileLines, requireBuildCommand } from "../scripts/wisp/builds";
import { startHost } from "../scripts/wisp/lan/host";
import { connectMenus } from "../scripts/wisp/menus";

test("[spec #100] every build-dependent command names its missing capability on an unknown build, and the menus and LAN host stop before connecting", async () => {
  const id = "9.9.9.99999";
  for (const [command, capability] of Object.entries(BUILD_COMMANDS)) {
    const result = await Effect.runPromise(requireBuildCommand(id, command as keyof typeof BUILD_COMMANDS).pipe(Effect.result));
    expect(result._tag, command).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure.message, command).toBe(`${capability} missing for ${id}; run client doctor to check this build (wisp#100)`);
  }
  expect(buildProfileLines(id)[0]).toBe(`unknown build ${id}; discovery needed (wisp#100)`);
  {
    const result = await Effect.runPromise(Effect.scoped(connectMenus({ port: 1, guid: "synthetic", buildId: "9.9.9.99999" })).pipe(Effect.result));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure.message).toContain("menuDriving missing for 9.9.9.99999");
  }
  {
    const map = { path: "synthetic", size: 0, crc32: 0, sha1: new Uint8Array(20), xoro: 0, width: 32, height: 32, layout: 0, players: [], forces: [] };
    const result = await Effect.runPromise(Effect.scoped(startHost({ buildId: "9.9.9.99999", map, gameName: "synthetic", clients: [], log: () => {} })).pipe(Effect.result));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure.message).toContain("lanPool missing for 9.9.9.99999");
  }
});

