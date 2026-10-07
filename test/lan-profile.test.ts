import { expect, test } from "bun:test";
import { poolProfile, preferences, PROFILES } from "../scripts/wisp/lan/pool";

test("a pool cap changes only foreground and background FPS in its preferences", () => {
  const base = preferences(poolProfile("parity"), 0).split("\n");
  const changed = preferences(poolProfile("parity", 40), 0).split("\n");
  expect(changed.filter((line, index) => line !== base[index])).toEqual(["backgroundmaxfps=40", "maxfps=40"]);
  expect(PROFILES["parity"]?.maxFps).toBe(60);
  expect(poolProfile("visual", 40).graphicsMode).toBe("reforged");
});

test("invalid frame caps fail before a pool client starts", () => {
  for (const fps of [0, -1, 1.5, Number.NaN, Infinity]) expect(() => poolProfile("parity", fps)).toThrow("--fps takes a positive whole number");
});

 test("3.0.1 profiles select the installed graphics modes without retired video keys", () => {
  for (const name of Object.keys(PROFILES)) {
    const text = preferences(poolProfile(name), 0);
    expect(text).toContain("assao=0\n");
    expect(text).toContain(`hd=${name === "visual" ? 1 : 0}\n`);
    for (const key of ["bloom", "portraitBloom", "particles", "spellfilter"]) expect(text).not.toContain(`${key}=`);
  }
  expect(preferences({ ...poolProfile("visual"), graphicsMode: "definitive" }, 0)).toContain("hd=2\n");
});
