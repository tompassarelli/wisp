/** How one lightning type draws, from its row in the install's Splats\LightningData.slk; widths and lengths are world units. */
export interface LightningLook {
  readonly texture: string;
  readonly width: number;
  readonly segment: number;
  readonly noise: number;
  readonly scale: number;
  readonly color: readonly [number, number, number];
}

export const LIGHTNING_DATA = "Splats\\LightningData.slk";

type Rows = ReadonlyMap<string, Readonly<Record<string, string>>>;

const COLOR_MAX = 255;
const COLUMNS = ["dir", "file", "avgseglen", "width", "r", "g", "b", "noisescale", "texcoordscale"];

/** The columns the table lacks, by the header names the install's file uses (compared without case). */
export function missingColumns(rows: Rows): string[] {
  const headers = new Set([...rows.values()].flatMap((row) => Object.keys(row)));
  return COLUMNS.filter((column) => !headers.has(column));
}

/** The look of the lightning type `codeName`, or a reason there is none: the row is absent or lacks a texture, a width or a segment length. */
export function lightningLook(rows: Rows, codeName: string): LightningLook | string {
  const row = rows.get(codeName) ?? [...rows].find(([name]) => name.toLowerCase() === codeName.toLowerCase())?.[1];
  if (row === undefined) return `no installed LightningData.slk row for ${codeName}`;
  const number = (key: string, otherwise?: number): number | undefined => {
    const text = row[key];
    const value = text === undefined || text === "" ? Number.NaN : Number(text);
    return Number.isFinite(value) ? value : otherwise;
  };
  const file = row.file;
  if (file === undefined || file === "") return `LightningData.slk ${codeName} names no file`;
  const width = number("width"), segment = number("avgseglen");
  if (width === undefined || segment === undefined) return `LightningData.slk ${codeName} has no width or average segment length`;
  const channels = ["r", "g", "b"].map((key) => number(key, 1) ?? 1);
  const divisor = Math.max(...channels) > 1 ? COLOR_MAX : 1;
  const [red = 1, green = 1, blue = 1] = channels.map((channel) => channel / divisor);
  const name = file.includes(".") ? file : `${file}.blp`;
  const dir = row.dir ?? "";
  return { texture: dir === "" ? name : `${dir}\\${name}`, width, segment, noise: number("noisescale", 0) ?? 0, scale: number("texcoordscale", 1) ?? 1, color: [red, green, blue] };
}
