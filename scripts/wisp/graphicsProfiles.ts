export type Graphics = "classic" | "definitive";
export const GRAPHICS: readonly Graphics[] = ["classic", "definitive"];

export type Lever =
  | "day-night-light" | "fog" | "height-fog-falloff" | "sky" | "cinematic-filter" | "point-lights"
  | "point-light-shadows" | "shadows" | "water" | "pbr" | "bloom" | "ambient-occlusion" | "terrain";
export const LEVERS: readonly Lever[] = [
  "day-night-light", "fog", "height-fog-falloff", "sky", "cinematic-filter", "point-lights",
  "point-light-shadows", "shadows", "water", "pbr", "bloom", "ambient-occlusion", "terrain",
];

export type LeverSupport = "drawn" | "absent" | "unsupported";

export const PROFILES: Readonly<Record<Graphics, Readonly<Record<Lever, LeverSupport>>>> = {
  classic: {
    "day-night-light": "drawn", fog: "drawn", sky: "drawn", "cinematic-filter": "drawn",

    "height-fog-falloff": "absent", "point-lights": "absent", "point-light-shadows": "absent", pbr: "absent", bloom: "absent", "ambient-occlusion": "absent",
    shadows: "drawn", water: "drawn", terrain: "unsupported",
  },
  definitive: {
    "day-night-light": "drawn", fog: "drawn", "height-fog-falloff": "drawn", sky: "drawn", "cinematic-filter": "drawn",
    "point-lights": "drawn", pbr: "drawn",
    "point-light-shadows": "drawn", shadows: "drawn", water: "drawn", bloom: "drawn", "ambient-occlusion": "drawn", terrain: "unsupported",
  },
};

export function parseGraphics(value: string): Graphics {
  if (!(GRAPHICS as readonly string[]).includes(value)) throw new Error(`--graphics is ${GRAPHICS.join(" or ")}`);
  return value as Graphics;
}

export function parseLevers(value: string): Lever[] {
  const names = value.split(",").map((name) => name.trim()).filter((name) => name !== "");
  for (const name of names) if (!(LEVERS as readonly string[]).includes(name)) throw new Error(`--look names an unknown lever ${name}; levers: ${LEVERS.join(", ")}`);
  return names as Lever[];
}

export const unsupportedLevers = (graphics: Graphics, levers: readonly Lever[]): Lever[] =>
  levers.filter((lever) => PROFILES[graphics][lever] === "unsupported");
