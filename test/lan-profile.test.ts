import { expect, test } from "bun:test";
import { clientSettings, measurementRefusal, poolProfile, preferences, PROFILES } from "../scripts/wisp/lan/pool";
import { profileSettings } from "../scripts/wisp/clientDoctorCommand";
import { preferenceChanges, withPreferences } from "../scripts/warcraft/preferences";

test("[reference] 3.0.1 profiles select the installed graphics modes without the video keys the 3.0 patch notes retired", () => {
  for (const name of Object.keys(PROFILES)) {
    const text = preferences(poolProfile(name), 0);
    expect(text).toContain("assao=0\n");
    expect(text).toContain(`hd=${name === "visual" ? 1 : 0}\n`);
    for (const key of ["bloom", "portraitBloom", "particles", "spellfilter"]) expect(text).not.toContain(`${key}=`);
  }
  expect(preferences({ ...poolProfile("visual"), graphicsMode: "definitive" }, 0)).toContain("hd=2\n");
});

test("[invariant] a signed-in client naming no profile gets minimal, its own display settings over it; perf measurements refuse anything but player", () => {
  const written = withPreferences("[Video]\nreswidth=1920\nmaxfps=61\n[Misc]\nhd=1\n[Sound]\nsfx=1\n[Gameplay]\nsfxvolume=70\n", profileSettings({ displaySettings: { windowx: "40" } }));
  expect(preferenceChanges(written, clientSettings("minimal")).map(({ key }) => key)).toEqual(["windowx"]);
  expect(written).toContain("reswidth=800\n");
  expect(written).toContain("hd=0\n");
  expect(written).toContain("sfx=0\n");
  expect(written).toContain("sfxvolume=70\n");
  expect(measurementRefusal([{ name: "a", profile: "player" }, { name: "b" }])).toContain("b runs minimal");
  expect(measurementRefusal([{ name: "a", profile: "player" }])).toBeUndefined();
});
