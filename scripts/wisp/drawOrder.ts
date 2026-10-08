interface Material { readonly Layers: readonly { readonly FilterMode?: number }[] }

export function orderDrawnModels<T>(poses: readonly T[], materials: (pose: T) => readonly Material[]): T[] {
  const transparent = (pose: T) => materials(pose).some((material) => material.Layers.some((layer) => (layer.FilterMode ?? 0) < 2)) ? 0 : 1;
  return [...poses].sort((a, b) => transparent(a) - transparent(b));
}
