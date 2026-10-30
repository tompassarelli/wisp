import type { model } from "../../vendor/war3-model.mjs";
import { normalize } from "../browser/matrix";

/** The directional light a day-night model casts at an hour: the world direction toward the light, its colour, and the ambient colour or "environment" when the model leaves the ambient to the environment map. */
export interface DayNightLight {
  readonly toward: readonly number[];
  readonly key: readonly number[];
  readonly ambient: readonly number[] | "environment";
}

type Track = model.AnimVector | ArrayLike<number> | number | undefined;

function sample(track: Track, frame: number, fallback: readonly number[]): number[] {
  if (track === undefined) return [...fallback];
  if (typeof track === "number") return [track];
  if (!("Keys" in track)) return Array.from(track);
  const keys = track.Keys;
  const first = keys[0];
  if (first === undefined) return [...fallback];
  if (frame <= first.Frame) return Array.from(first.Vector);
  for (let index = 1; index < keys.length; index++) {
    const before = keys[index - 1], after = keys[index];
    if (before === undefined || after === undefined || frame >= after.Frame) continue;
    if (track.LineType === 0) return Array.from(before.Vector);
    const t = (frame - before.Frame) / (after.Frame - before.Frame);
    return Array.from(before.Vector, (value, i) => value + ((after.Vector[i] ?? value) - value) * t);
  }
  return Array.from(keys[keys.length - 1]?.Vector ?? fallback);
}

function rotate(q: readonly number[], v: readonly number[]): number[] {
  const [x = 0, y = 0, z = 0, w = 1] = normalize(q), [vx = 0, vy = 0, vz = 0] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

export function lightAtHour(data: model.Model, hours: number): DayNightLight | undefined {
  const light = data.Lights.find((candidate) => candidate.LightType === 1) ?? data.Lights[0];
  if (light === undefined) return undefined;
  const [start = 0, end = 0] = Array.from(data.Sequences[0]?.Interval ?? [0, 0]);
  const frame = start + (end - start) * (((hours % 24) + 24) % 24) / 24;
  if ((sample(light.Visibility, frame, [1])[0] ?? 1) <= 0) return undefined;
  const colour = (track: typeof light.Color, intensity: typeof light.Intensity) => {
    const [blue = 1, green = 1, red = 1] = sample(track, frame, [1, 1, 1]), scale = sample(intensity, frame, [1])[0] ?? 1;
    return [red * scale, green * scale, blue * scale];
  };
  const toward = light.LightType === 1 ? normalize(rotate(sample(light.Rotation, frame, [0, 0, 0, 1]), [0, 0, 1])) : [0, 0, 1];
  const key = light.LightType === 2 ? [0, 0, 0] : colour(light.Color, light.Intensity);
  if ((sample(light.AmbIntensity, frame, [1])[0] ?? 1) <= 0) return { toward, key, ambient: "environment" };
  return { toward, key, ambient: colour(light.AmbColor, light.AmbIntensity) };
}
