export interface Profile {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly maxFps: number;

  readonly video: Readonly<Record<string, number>>;

  readonly graphicsMode: "classic" | "reforged";

  readonly sound: boolean;

  readonly music: boolean;
}

const LOWEST: Readonly<Record<string, number>> = {
  antialiasing: 0, assao: 0, foliagequality: 0, lightingquality: 0, pointlightshadowquality: 0,
  shadowquality: 0, texquality: 0, waterquality: 0, vsync: 0,
};

const PARITY: Profile = { name: "parity", width: 800, height: 600, maxFps: 60, video: LOWEST, graphicsMode: "classic", sound: false, music: false };
const VISUAL: Profile = { name: "visual", width: 1280, height: 720, maxFps: 60, video: { ...LOWEST, lightingquality: 2, texquality: 1 }, graphicsMode: "reforged", sound: true, music: true };
const CAPTURE_VIDEO = { ...LOWEST, lightingquality: 2, texquality: 1, shadowquality: 2, pointlightshadowquality: 2, waterquality: 2, assao: 1 };
const captureProfile = (graphicsMode: Profile["graphicsMode"]): Profile => ({ ...VISUAL, name: `capture-${graphicsMode}`, video: CAPTURE_VIDEO, graphicsMode, sound: true, music: false });
const CAPTURE_PROFILES = {
  "capture-classic": captureProfile("classic"),
  "capture-reforged": captureProfile("reforged"),
};
export const PROFILES: Readonly<Record<string, Profile>> = {
  parity: PARITY,
  checks: { name: "checks", width: 800, height: 600, maxFps: 60, video: LOWEST, graphicsMode: "classic", sound: true, music: false },

  hfr: { name: "hfr", width: 800, height: 600, maxFps: 144, video: LOWEST, graphicsMode: "classic", sound: false, music: false },
  visual: { ...VISUAL, graphicsMode: "classic" },
  "capture-classic": CAPTURE_PROFILES["capture-classic"],
  "capture-classic-1080": { ...CAPTURE_PROFILES["capture-classic"], name: "capture-classic-1080", width: 1920, height: 1080 },
};

function profileSections(profile: Profile, windowX: number): Record<string, Record<string, number>> {
  const video: Record<string, number> = {
    ...profile.video,
    adapter: 0,
    backgroundmaxfps: profile.maxFps,
    colordepth: 32,
    gamma: 30,
    maxfps: profile.maxFps,
    previouswindowmode: 0,
    refreshrate: 60,
    resetdefaults: 0,
    reswidth: profile.width,
    resheight: profile.height,
    supersampling: 100,
    windowmode: 0,
    windowwidth: profile.width,
    windowheight: profile.height,
    windowx: windowX,
    windowy: 0,
  };
  const sound = profile.sound ? 1 : 0;
  return {
    Video: video,
    Misc: { hd: { classic: 0, reforged: 1 }[profile.graphicsMode] },
    Sound: { ambient: sound, environmental: sound, movement: sound, music: profile.music ? 1 : 0, positional: sound, sfx: sound, unit: sound, nosoundwarn: 1 },
  };
}

export function preferences(profile: Profile, windowX: number): string {
  return Object.entries(profileSections(profile, windowX)).map(([name, values]) => `[${name}]\n${Object.keys(values).sort().map((key) => `${key}=${values[key]}`).join("\n")}\n`).join("\n");
}

const CLIENT_PROFILES = {
  minimal: { ...PARITY, name: "minimal" },
  visual: VISUAL,
  ...CAPTURE_PROFILES,
  player: { name: "player", width: 1920, height: 1080, maxFps: 60, video: { ...LOWEST, lightingquality: 2 }, graphicsMode: "reforged", sound: true, music: true },
} as const satisfies Readonly<Record<string, Profile>>;
export type ClientProfile = keyof typeof CLIENT_PROFILES;
export const CLIENT_PROFILE_NAMES = Object.keys(CLIENT_PROFILES) as readonly ClientProfile[];

export const clientSettings = (profile: ClientProfile): Record<string, Record<string, string>> =>
  Object.fromEntries(Object.entries(profileSections(CLIENT_PROFILES[profile], 0)).map(([section, values]) => [section, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))]));

export const desktopSize = (profile: Profile) => `${profile.width + 40}x${profile.height + 40}`;
