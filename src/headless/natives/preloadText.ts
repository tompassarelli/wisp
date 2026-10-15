import { errorFile, FILE_IO_ABILITY } from "../../runtime/gameFiles";
import type { ClientFiles, NativeBehavior } from "../clientTypes";

export interface PreloadContext {
  readonly slot: number;
  readonly filePrefix: string;
  readonly stored: ClientFiles | undefined;
  readonly files: Map<string, string[]>;
  readonly published: ReadonlyMap<string, readonly string[]>;
  readonly messages: string[];
  readonly errors: string[];
  readonly missed: (this: void) => void;
}

export class PreloadText {
  private readonly tooltips = new Map<string, string>();
  /** Preloader runs the content it first read from a path for the rest of the session. */
  private readonly preloaded = new Map<string, readonly string[]>();
  private preload: string[] = [];

  constructor(private readonly context: PreloadContext) {}

  preloadedFiles(): string[] {
    return [...this.preloaded.keys()];
  }

  private report(lines: readonly string[]): void {
    const heading = lines[0] ?? "";
    this.context.errors.push(`error in ${heading.slice(heading.indexOf(" in ") + 4)}: ${lines[1] ?? ""}`);
  }

  behaviors(): Readonly<Record<string, NativeBehavior>> {
    const { slot, filePrefix, stored, files, published, messages } = this.context;
    const show = (text: string): void => { messages.push(text); };
    return {
      DisplayTextToPlayer: (player: number, _x: number, _y: number, text: string) => {
        if (player === slot) show(text);
      },
      DisplayTimedTextToPlayer: (player: number, _x: number, _y: number, _duration: number, text: string) => {
        if (player === slot) show(text);
      },
      DisplayTextToForce: (_force: unknown, text: string) => show(text),
      PreloadGenClear: () => {
        this.preload = [];
      },
      // PreloadGenClear starts the modeled buffer; Start only enables native file generation.
      PreloadGenStart: () => undefined,
      Preload: (line: string) => {
        this.preload.push(line);
      },
      PreloadGenEnd: (name: string) => {
        files.set(name, this.preload);
        if (name === errorFile(slot, filePrefix)) this.report(this.preload);
        stored?.written(name, this.preload);
      },

      Preloader: (name: string) => {
        const chunks = this.preloaded.get(name) ?? published.get(name) ?? stored?.read(name);
        if (chunks === undefined) {
          this.context.missed();
          return;
        }
        this.preloaded.set(name, chunks);
        for (let level = 0; level < chunks.length; level++) this.tooltips.set(`${FILE_IO_ABILITY} ${level}`, chunks[level] ?? "");
      },
      BlzSetAbilityTooltip: (ability: number, text: string, level: number) => {
        this.tooltips.set(`${ability} ${level}`, text);
      },
      BlzGetAbilityTooltip: (ability: number, level: number) => this.tooltips.get(`${ability} ${level}`) ?? "",
    };
  }
}
