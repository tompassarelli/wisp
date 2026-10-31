import { WARCRAFT_TEMPLATE_FDFS } from "../compile/frames";
import { type FdfFrame, parseFdf, parseSections } from "./fdf";

/** A BACKDROP's look: a background, tiled at `tile` UI units when it tiles, inside `insets`, framed by an eight-piece edge file whose corners are `corner` UI units square. */
export interface Backdrop {
  readonly background: string;
  readonly edge: string;
  readonly corner: number;
  readonly tile: number;
  readonly insets: readonly number[];
  readonly corners: string;
}

/** How a Warcraft control template draws: the backdrop at rest, held down and disabled, and the texture added over it under the cursor. */
export interface ControlSkin {
  readonly backdrop?: Backdrop;
  readonly pushed?: Backdrop;
  readonly disabled?: Backdrop;
  readonly highlight?: string;
}

type Reader = (path: string) => Promise<Uint8Array | undefined>;

const SKINS_FILE = "UI\\war3skins.txt";
const DEFAULT_SKIN = "Default";

const decode = (bytes: Uint8Array | undefined) => (bytes === undefined ? "" : new TextDecoder().decode(bytes));
const number = (values: readonly string[] | undefined, index = 0) => Number.parseFloat(values?.[index] ?? "") || 0;

export class TemplateIndex {
  private readonly byName = new Map<string, FdfFrame>();

  add(frames: readonly FdfFrame[]): void {
    for (const frame of frames) {
      if (!this.byName.has(frame.name)) this.byName.set(frame.name, frame);
      this.add(frame.children);
    }
  }

  get(name: string): FdfFrame | undefined {
    return this.byName.get(name);
  }

  fields(frame: FdfFrame, seen = new Set<FdfFrame>()): ReadonlyMap<string, readonly string[]> {
    const base = frame.inherits === undefined ? undefined : this.byName.get(frame.inherits);
    if (base === undefined || seen.has(base)) return frame.fields;
    seen.add(frame);
    return new Map([...this.fields(base, seen), ...frame.fields]);
  }

  children(frame: FdfFrame, seen = new Set<FdfFrame>()): readonly FdfFrame[] {
    const base = frame.withChildren && frame.inherits !== undefined ? this.byName.get(frame.inherits) : undefined;
    if (base === undefined || seen.has(base)) return frame.children;
    seen.add(frame);
    return [...this.children(base, seen), ...frame.children];
  }
}

/** Resolves a control template from the frame definitions and skin table the user's install ships: the files are read when Wisp runs, never stored. */
export function resolveControlSkin(index: TemplateIndex, skins: ReadonlyMap<string, ReadonlyMap<string, string>>, template: string, race: string): ControlSkin | undefined {
  const root = index.get(template);
  if (root === undefined) return undefined;
  const fields = index.fields(root);
  const children = index.children(root);
  const part = (field: string) => {
    const name = fields.get(field)?.[0];
    const child = name === undefined ? undefined : children.find((each) => each.name === name) ?? index.get(name);
    return child === undefined ? undefined : index.fields(child);
  };
  const file = (own: ReadonlyMap<string, readonly string[]>, key: string) => {
    const named = own.get(key)?.[0] ?? "";
    if (named === "" || !own.has("DecorateFileNames")) return named;
    return skins.get(race)?.get(named) ?? skins.get(DEFAULT_SKIN)?.get(named) ?? named;
  };
  const backdrop = (field: string): Backdrop | undefined => {
    const own = part(field);
    if (own === undefined) return undefined;
    const insets = own.get("BackdropBackgroundInsets") ?? [];
    return {
      background: file(own, "BackdropBackground"),
      edge: file(own, "BackdropEdgeFile"),
      corner: number(own.get("BackdropCornerSize")),
      tile: own.has("BackdropTileBackground") ? number(own.get("BackdropBackgroundSize")) : 0,
      insets: [0, 1, 2, 3].map((at) => number(insets, at)),
      corners: own.get("BackdropCornerFlags")?.[0] ?? "",
    };
  };
  const highlight = part("ControlMouseOverHighlight");
  const additive = highlight?.get("HighlightType")?.[0] === "FILETEXTURE" && highlight.get("HighlightAlphaMode")?.[0] === "ADD";
  const backdrops = { backdrop: backdrop("ControlBackdrop"), pushed: backdrop("ControlPushedBackdrop"), disabled: backdrop("ControlDisabledBackdrop") };
  const shine = highlight !== undefined && additive ? file(highlight, "HighlightAlphaFile") : "";
  if (backdrops.backdrop === undefined && shine === "") return undefined;
  return {
    ...(backdrops.backdrop === undefined ? {} : { backdrop: backdrops.backdrop }),
    ...(backdrops.pushed === undefined ? {} : { pushed: backdrops.pushed }),
    ...(backdrops.disabled === undefined ? {} : { disabled: backdrops.disabled }),
    ...(shine === "" ? {} : { highlight: shine }),
  };
}

/** Reads each Warcraft control template a frame names once, with the frame files it includes; `skin` is undefined until it is read, and for a template the install does not define. */
export function createControlSkins(read: Reader, report: (problem: string) => void, race = "Human") {
  const index = new TemplateIndex();
  const files = new Map<string, Promise<void>>();
  const skins = new Map<string, ControlSkin | undefined>();
  let table: Promise<ReadonlyMap<string, ReadonlyMap<string, string>>> | undefined;
  const load = (path: string): Promise<void> => {
    const known = files.get(path);
    if (known !== undefined) return known;
    const started = read(path).then(async (bytes) => {
      if (bytes === undefined) return report(`missing frame file ${path}`);
      const file = parseFdf(decode(bytes));
      await Promise.all(file.includes.map(load));
      index.add(file.frames);
    });
    files.set(path, started);
    return started;
  };
  return {
    skin(template: string): ControlSkin | undefined {
      if (skins.has(template)) return skins.get(template);
      const path = WARCRAFT_TEMPLATE_FDFS.get(template);
      if (path === undefined) return undefined;
      skins.set(template, undefined);
      table ??= read(SKINS_FILE).then((bytes) => parseSections(decode(bytes)));
      void Promise.all([load(path), table])
        .then(([, sections]) => { skins.set(template, resolveControlSkin(index, sections, template, race)); })
        .catch((cause: unknown) => report(`${template}: ${cause instanceof Error ? cause.message : String(cause)}`));
      return undefined;
    },
  };
}

