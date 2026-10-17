import type { RenderScene } from "./renderScene";

/** Pixels, origin at the top left, y down. */
export interface PixelBox { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

export interface PixelRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface GeosetBounds {
  readonly index: number;
  readonly alpha: number;
  /** The first material layer's filter mode (war3-model's FilterMode: 0 None, 1 Transparent, 2 Blend, 3 Additive, ...). */
  readonly filterMode: number;
  readonly drawn: boolean;
}

export interface NodeBounds {
  readonly id: number;
  readonly name: string;
  /** Box of the drawn vertices this node weights most; undefined when it weights none in front of the eye. */
  readonly box: PixelBox | undefined;
  readonly pivot: { readonly x: number; readonly y: number; readonly behindEye: boolean };
}

export interface ModelBounds {
  readonly handle: number;
  readonly model: string;
  readonly unit: boolean;
  /** Box of every drawn vertex between the near and far planes; undefined when none is. */
  readonly box: PixelBox | undefined;
  readonly offFrame: boolean;
  readonly behindEye: boolean;
  readonly farCulled: boolean;
  readonly geosets: readonly GeosetBounds[];
  readonly nodes: readonly NodeBounds[];
  /** How drawn team-glow geosets were bounded: by the install's team-glow texture, or by the disc rule without it. */
  readonly teamGlow?: "texture" | "disc";
  /** Box of the drawn pixels of every geoset with an opaque (filter mode None) layer; absent when none draws. */
  readonly body?: PixelBox;
}

/** Where a UI texture came from: the asset layer that supplied it and the sha256 of its bytes. */
export interface TextureIdentity { readonly layer: string; readonly sha256: string }

/** A portrait texture's receipt: the scene it was rendered from at `width` x `height`, the crop of that render the texture holds, and the game's parts. */
export interface Portrait {
  readonly scene: Pick<RenderScene, "camera" | "effects" | "world">;
  readonly width: number;
  readonly height: number;
  /** Render pixels the texture holds, origin top left, y down. */
  readonly crop: PixelRect;
  /** The texture's size and, when it has one, its alpha per texel (0-255, row-major from the top row): a texel under half opacity shows the backdrop more than the portrait. */
  readonly texture: { readonly width: number; readonly height: number; readonly alpha?: ArrayLike<number> };
  /** Declared part name to node names; `head` and `weapon` also give the crown margin and the head pixels the weapon hides. */
  readonly parts: Readonly<Record<string, readonly string[]>>;
}
