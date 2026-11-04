import { expect, test } from "bun:test";
import { CHROME_ANGLES, playerChromeArguments, referenceChromeArguments, renderChromeArguments } from "../host/render/chromeArguments";

test("every Chrome Wisp launches keeps passwords in its throwaway profile, not the desktop keyring", () => {
  const launches = [
    ...CHROME_ANGLES.map((angle) => renderChromeArguments("/tmp/profile", angle, "http://127.0.0.1:1/")),
    ...[true, false].flatMap((headless) => [true, false].map((ci) => playerChromeArguments("/tmp/profile", { width: 1280, height: 720 }, "http://127.0.0.1:1/", headless, ci))),
    referenceChromeArguments("/tmp/profile", "/tmp/page.html"),
  ];
  for (const launch of launches) {
    expect(launch).toContain("--password-store=basic");
    expect(launch).toContain("--user-data-dir=/tmp/profile");
  }
});
