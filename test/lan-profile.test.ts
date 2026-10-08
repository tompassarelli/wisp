import { expect, test } from "bun:test";
import { poolProfile, preferences, PROFILES } from "../scripts/wisp/lan/pool";

test("[reference] 3.0.1 profiles select the installed graphics modes without the video keys the 3.0 patch notes retired", () => {
  for (const name of Object.keys(PROFILES)) {
    const text = preferences(poolProfile(name), 0);
    expect(text).toContain("assao=0\n");
    expect(text).toContain(`hd=${name === "visual" ? 1 : 0}\n`);
    for (const key of ["bloom", "portraitBloom", "particles", "spellfilter"]) expect(text).not.toContain(`${key}=`);
  }
  expect(preferences({ ...poolProfile("visual"), graphicsMode: "definitive" }, 0)).toContain("hd=2\n");
});
