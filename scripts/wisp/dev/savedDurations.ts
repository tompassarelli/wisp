import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export class SavedDurations {
  private readonly file: string | undefined;
  private readonly top: string = "";

  constructor(common: string | undefined, top: string | undefined) {
    if (common === undefined || top === undefined) return;
    this.file = join(common, "wisp", "dev-durations.json");
    this.top = top;
  }

  load(into: Map<string, number>): void {
    if (this.file === undefined) return;
    for (const [path, milliseconds] of Object.entries(this.read())) into.set(resolve(this.top, path), milliseconds);
  }

  save(durations: ReadonlyMap<string, number>): void {
    if (this.file === undefined) return;
    const merged = this.read();
    for (const [path, milliseconds] of durations) if (path.startsWith(sep)) merged[relative(this.top, path)] = milliseconds;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}`;
      writeFileSync(temporary, JSON.stringify(merged));
      renameSync(temporary, this.file);
    } catch {
      return;
    }
  }

  private read(): Record<string, number> {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file ?? "", "utf8"));
      if (typeof parsed !== "object" || parsed === null) return {};
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
    } catch {
      return {};
    }
  }
}
