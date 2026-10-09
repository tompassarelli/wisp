import { expect, test } from "bun:test";
import { CLIENT_PROFILES, clientSettings, measurementRefusal, poolProfile, preferences, PROFILES } from "../scripts/wisp/lan/pool";
import { profileSettings } from "../scripts/wisp/clientDoctorCommand";
import { preferenceChanges, withPreferences } from "../scripts/warcraft/preferences";

test("[reference] pool profiles are Classic only (unsigned clients draw Classic at any hd); signed-in profiles select their graphics mode; no video keys the 3.0 patch notes retired", () => {
  for (const [name, hd, assao] of [["parity", 0, 0], ["checks", 0, 0], ["hfr", 0, 0], ["visual", 0, 0], ["capture-classic", 0, 1]] as const) {
    const text = preferences(poolProfile(name), 0);
    expect(text).toContain(`assao=${assao}\n`);
    expect(text).toContain(`hd=${hd}\n`);
    for (const key of ["bloom", "portraitBloom", "particles", "spellfilter"]) expect(text).not.toContain(`${key}=`);
  }
  for (const [name, hd] of [["visual", 1], ["capture-reforged", 1], ["capture-definitive", 2]] as const) expect(preferences(CLIENT_PROFILES[name], 0)).toContain(`hd=${hd}\n`);
  expect(() => poolProfile("capture-definitive")).toThrow();
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
