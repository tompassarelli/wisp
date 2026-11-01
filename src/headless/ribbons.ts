/** Fields per edge a map passes to `WispSetRibbon`: one end x, y, z, the other end x, y, z, alpha. */
const RIBBON_EDGE_FIELDS = 7;
export const MAX_RIBBON_EDGES = 32;
const MAX_RIBBONS = 8;

export interface RibbonPose {
  readonly id: number;
  readonly edges: readonly (readonly number[])[];
  readonly color: readonly [number, number, number];
}

/** The strips a map draws through Wisp's own `WispSetRibbon`: one strip per id, replaced by each call and removed by a count of 0. */
export class Ribbons {
  private readonly strips = new Map<number, RibbonPose>();

  behaviors(): Record<string, (...args: never[]) => unknown> {
    return {
      WispSetRibbon: (id: number, points: readonly number[], count: number, red: number, green: number, blue: number) => {
        if (count <= 0) {
          this.strips.delete(id);
          return;
        }
        if (count > MAX_RIBBON_EDGES) throw new Error(`WispSetRibbon ${id}: ${count} edges, at most ${MAX_RIBBON_EDGES}`);
        if (points.length < count * RIBBON_EDGE_FIELDS) throw new Error(`WispSetRibbon ${id}: ${count} edges need ${count * RIBBON_EDGE_FIELDS} numbers, got ${points.length}`);
        if (!this.strips.has(id) && this.strips.size >= MAX_RIBBONS) throw new Error(`WispSetRibbon ${id}: at most ${MAX_RIBBONS} ribbons at once`);
        const edges: number[][] = [];
        for (let edge = 0; edge < count; edge++) edges.push(points.slice(edge * RIBBON_EDGE_FIELDS, (edge + 1) * RIBBON_EDGE_FIELDS));
        this.strips.set(id, { id, edges, color: [red, green, blue] });
      },
    };
  }

  poses(): RibbonPose[] {
    return [...this.strips.values()].sort((a, b) => a.id - b.id);
  }
}
