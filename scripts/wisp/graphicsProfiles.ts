/**
 * The graphics modes a headless render draws and what each one draws of
 * Warcraft III 3.0.1's look (wisp:docs/headless.md, "Graphics profiles").
 * Reforged (`hd=1`) is not a profile: Classic and Definitive are supported.
 */
export type Graphics = "classic" | "definitive";
export const GRAPHICS: readonly Graphics[] = ["classic", "definitive"];

/** A part of the look a check can ask for. */
export type Lever =
  | "day-night-light" | "fog" | "height-fog-falloff" | "sky" | "cinematic-filter" | "point-lights"
  | "point-light-shadows" | "shadows" | "water" | "pbr" | "bloom" | "ambient-occlusion" | "terrain";
export const LEVERS: readonly Lever[] = [
  "day-night-light", "fog", "height-fog-falloff", "sky", "cinematic-filter", "point-lights",
  "point-light-shadows", "shadows", "water", "pbr", "bloom", "ambient-occlusion", "terrain",
];

/**
 * How a profile treats a lever: `drawn` as Warcraft draws it in that mode,
 * `absent` because that mode draws nothing for it either, or `unsupported`:
 * Warcraft draws it and Wisp does not, so a look check that asks for it fails.
 */
export type LeverSupport = "drawn" | "absent" | "unsupported";

export const PROFILES: Readonly<Record<Graphics, Readonly<Record<Lever, LeverSupport>>>> = {
  classic: {
    "day-night-light": "drawn", fog: "drawn", sky: "drawn", "cinematic-filter": "drawn",
    // Classic draws a height fog's linear range only, and no model omni light, point-light shadows, PBR, bloom or ambient occlusion.
    "height-fog-falloff": "absent", "point-lights": "absent", "point-light-shadows": "absent", pbr: "absent", bloom: "absent", "ambient-occlusion": "absent",
    shadows: "drawn", water: "unsupported", terrain: "unsupported",
  },
  definitive: {
    "day-night-light": "drawn", fog: "drawn", "height-fog-falloff": "unsupported", sky: "drawn", "cinematic-filter": "drawn",
    "point-lights": "drawn", pbr: "drawn",
    "point-light-shadows": "drawn", shadows: "drawn", water: "unsupported", bloom: "drawn", "ambient-occlusion": "drawn", terrain: "unsupported",
  },
};

export function parseGraphics(value: string): Graphics {
  if (!(GRAPHICS as readonly string[]).includes(value)) throw new Error(`--graphics is ${GRAPHICS.join(" or ")}`);
  return value as Graphics;
}

/** The levers a look check asks for, from `--look a,b`; an unknown name is refused. */
export function parseLevers(value: string): Lever[] {
  const names = value.split(",").map((name) => name.trim()).filter((name) => name !== "");
  for (const name of names) if (!(LEVERS as readonly string[]).includes(name)) throw new Error(`--look names an unknown lever ${name}; levers: ${LEVERS.join(", ")}`);
  return names as Lever[];
}

/** The requested levers this profile cannot draw; a render that asks for any fails with their names. */
export const unsupportedLevers = (graphics: Graphics, levers: readonly Lever[]): Lever[] =>
  levers.filter((lever) => PROFILES[graphics][lever] === "unsupported");
