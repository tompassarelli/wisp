// Where the framed chat box puts its parts: presentation only, in screen coordinates (0.8 wide, 0.6 high, origin bottom left).

import { f32 } from "../sim/f32";

/** A rectangle by its bottom-left corner and size. */
export interface ChatRect {
  readonly left: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface ChatFrameLayout {
  /** The title bar and its text; undefined when `titleHeight` is 0. */
  readonly title: { readonly bar: ChatRect; readonly text: ChatRect } | undefined;
  /** How many history rows fit, and where they go: the newest row's bottom edge is `rows.bottom`. */
  readonly rowCount: number;
  readonly rows: ChatRect;
  readonly track: ChatRect;
  readonly thumb: ChatRect;
  /** The native window's typing line, under the rows; undefined where the box has none. */
  readonly entry: ChatRect | undefined;
}

export interface ChatFrameMeasures {
  readonly rowHeight: number;
  readonly margin: number;
  /** 0 for a box without a title bar. */
  readonly titleHeight: number;
  readonly barWidth: number;
  readonly entryHeight: number;
}

/**
 * The framed box filling `slot`, inset by the margin: the title bar (when `titleHeight` is not 0) along the top, the entry line (when the box has one) along the bottom, and
 * between them as many history rows as fit, at most `maxRows`, sitting on the entry line with the scrollbar beside them at the right edge,
 * whose thumb shows the rows' share of the `total` rows the history wraps to, at the newest end.
 */
export function chatFrameLayout(slot: ChatRect, measures: ChatFrameMeasures, entry: boolean, total: number, maxRows: number): ChatFrameLayout {
  const { rowHeight, margin, titleHeight, barWidth, entryHeight } = measures;
  const left = f32(slot.left + margin);
  const width = f32(slot.width - f32(margin * 2.0));
  const top = f32(f32(slot.bottom + slot.height) - margin);
  const titled = titleHeight > 0.0;
  const titleBottom = f32(top - titleHeight);
  const inner = f32(slot.bottom + margin);
  const rowsBottom = entry ? f32(inner + f32(entryHeight + margin)) : inner;
  const space = f32(f32(titled ? f32(titleBottom - margin) : titleBottom) - rowsBottom);
  let rowCount = 0;
  while (rowCount < maxRows && f32(rowHeight * (rowCount + 1)) <= space) rowCount++;
  const rowsHeight = f32(rowHeight * rowCount);
  const barLeft = f32(f32(left + width) - barWidth);
  const shown = total <= rowCount ? 1.0 : f32(rowCount / total);
  return {
    title: titled ? {
      bar: { left, bottom: titleBottom, width, height: titleHeight },
      text: { left: f32(left + margin), bottom: titleBottom, width: f32(width - f32(margin * 2.0)), height: titleHeight },
    } : undefined,
    rowCount,
    rows: { left: f32(left + margin), bottom: rowsBottom, width: f32(f32(barLeft - margin) - f32(left + margin)), height: rowsHeight },
    track: { left: barLeft, bottom: rowsBottom, width: barWidth, height: rowsHeight },
    thumb: { left: barLeft, bottom: rowsBottom, width: barWidth, height: f32(rowsHeight * shown) },
    entry: entry ? { left, bottom: inner, width, height: entryHeight } : undefined,
  };
}
