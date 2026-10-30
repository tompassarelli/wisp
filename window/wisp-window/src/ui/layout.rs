//! Where a UI frame's pixels and text go: UI units to pixels, `|` codes, wrapping at the frame's width and alignment.

use super::scene::{Horizontal, Vertical};

pub const LEADING: f32 = 1.2;
const MINIMUM_DEFAULT_SIZE: f32 = 10.0;
const DEFAULT_SIZE_UNITS: f32 = 0.0122;
const FALLBACK_HEIGHT: f32 = 15.0;
const UNITS_HIGH: f32 = 0.6;
const UNITS_WIDE: f32 = 0.8;

/// A rectangle in pixels: x, y, width, height.
pub type Pixels = [f32; 4];

/// UI units are 0.8 x 0.6 at 4:3, scaled by the screen height and centred horizontally.
pub fn pixels(rectangle: [f32; 4], area: Pixels) -> Pixels {
    let [left, top, right, bottom] = rectangle;
    let scale = area[3] / UNITS_HIGH;
    [area[0] + area[2] / 2.0 + (left - UNITS_WIDE / 2.0) * scale, area[1] + (UNITS_HIGH - top) * scale, (right - left) * scale, (top - bottom) * scale]
}

/// The font size in pixels: the frame's own height, or one that scales with the screen and the frame's height.
pub fn font_size(font_height: f32, scale: f32, frame_height: f32, area_height: f32) -> f32 {
    let screen = area_height / UNITS_HIGH;
    let base = if font_height > 0.0 { font_height * screen } else { MINIMUM_DEFAULT_SIZE.max((DEFAULT_SIZE_UNITS * screen).min(if frame_height > 0.0 { frame_height } else { FALLBACK_HEIGHT })) };
    base * scale
}

/// A frame's text with `|c` and `|r` codes taken out and `|n` as a line break; the first colour code colours the whole text, as the Chrome renderer does.
pub struct Plain {
    pub text: String,
    pub code: Option<[u8; 4]>,
}

pub fn plain(raw: &str) -> Plain {
    let bytes = raw.as_bytes();
    let mut text = String::with_capacity(raw.len());
    let mut code = None;
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'|' {
            let next = bytes.get(at + 1).map(u8::to_ascii_lowercase);
            if next == Some(b'c') {
                if let Some(argb) = raw.get(at + 2..at + 10).and_then(|digits| u32::from_str_radix(digits, 16).ok().filter(|_| digits.bytes().all(|byte| byte.is_ascii_hexdigit()))) {
                    code.get_or_insert([(argb >> 16) as u8, (argb >> 8) as u8, argb as u8, (argb >> 24) as u8]);
                    at += 10;
                    continue;
                }
            } else if next == Some(b'r') {
                at += 2;
                continue;
            } else if next == Some(b'n') {
                text.push('\n');
                at += 2;
                continue;
            }
        }
        let width = raw[at..].chars().next().map_or(1, char::len_utf8);
        text.push_str(&raw[at..at + width]);
        at += width;
    }
    Plain { text, code }
}

/// One line of text: its byte range in the plain text, its width, and where its left edge goes within the frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Line {
    pub start: usize,
    pub end: usize,
    pub width: f32,
    pub left: f32,
}

/// Breaks `text` at `\n` and at spaces so no line is wider than `limit` (a single long word keeps its line), then aligns each line within `limit`.
/// `measure` gives the width of a slice of `text`.
pub fn lines(text: &str, limit: f32, horizontal: Horizontal, out: &mut Vec<Line>, mut measure: impl FnMut(&str) -> f32) {
    out.clear();
    let mut offset = 0;
    for paragraph in text.split('\n') {
        let before = out.len();
        wrap(text, offset, offset + paragraph.len(), limit, out, &mut measure);
        if out.len() == before {
            out.push(Line { start: offset, end: offset, width: 0.0, left: 0.0 });
        }
        offset += paragraph.len() + 1;
    }
    for line in out.iter_mut() {
        line.left = match horizontal {
            Horizontal::Left => 0.0,
            Horizontal::Center => (limit - line.width) / 2.0,
            Horizontal::Right => limit - line.width,
        };
    }
}

fn wrap(text: &str, start: usize, end: usize, limit: f32, out: &mut Vec<Line>, measure: &mut impl FnMut(&str) -> f32) {
    let whole = measure(&text[start..end]);
    if limit <= 0.0 || whole <= limit {
        out.push(Line { start, end, width: whole, left: 0.0 });
        return;
    }
    let mut row = start;
    let mut row_end = start;
    let mut row_width = 0.0;
    let mut word = start;
    loop {
        let after = text[word..end].find(' ').map_or(end, |space| word + space);
        let candidate = measure(&text[row..after]);
        if row_end != row && candidate > limit {
            out.push(Line { start: row, end: row_end, width: row_width, left: 0.0 });
            row = word;
            row_width = measure(&text[row..after]);
        } else {
            row_width = candidate;
        }
        row_end = after;
        if after >= end {
            break;
        }
        word = after + 1;
    }
    out.push(Line { start: row, end: row_end, width: row_width, left: 0.0 });
}

/// The top of the first line within a frame of `height` pixels.
pub fn first_line_top(vertical: Vertical, height: f32, lines: usize, size: f32) -> f32 {
    let block = lines as f32 * size * LEADING;
    match vertical {
        Vertical::Top => 0.0,
        Vertical::Middle => height / 2.0 - block / 2.0,
        Vertical::Bottom => height - block,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mono(text: &str) -> f32 {
        text.chars().count() as f32 * 10.0
    }

    fn broken(text: &str, limit: f32, horizontal: Horizontal) -> Vec<(String, f32)> {
        let mut out = Vec::new();
        lines(text, limit, horizontal, &mut out, mono);
        out.iter().map(|line| (text[line.start..line.end].to_string(), line.left)).collect()
    }

    #[test]
    fn ui_units_centre_on_the_screen_and_scale_with_its_height() {
        let [x, y, width, height] = pixels([0.3, 0.4, 0.5, 0.2], [0.0, 0.0, 1280.0, 720.0]);
        assert_eq!((x.round(), y.round(), width.round(), height.round()), (520.0, 240.0, 240.0, 240.0));
        assert_eq!(pixels([0.4, 0.6, 0.8, 0.0], [100.0, 50.0, 800.0, 600.0])[..2], [500.0, 50.0]);
    }

    #[test]
    fn font_size_follows_the_font_or_the_frame() {
        assert_eq!(font_size(0.02, 1.0, 0.0, 720.0), 0.02 * 1200.0);
        assert_eq!(font_size(0.02, 2.0, 0.0, 720.0), 0.02 * 1200.0 * 2.0);
        assert_eq!(font_size(0.0, 1.0, 100.0, 720.0), 0.0122 * 1200.0);
        assert_eq!(font_size(0.0, 1.0, 12.0, 720.0), 12.0);
        assert_eq!(font_size(0.0, 1.0, 0.0, 300.0), 10.0);
    }

    #[test]
    fn codes_come_out_of_the_text() {
        let plain = plain("|cffffcc00W A S D|r move|nnext |cff00ff00more|r");
        assert_eq!(plain.text, "W A S D move\nnext more");
        assert_eq!(plain.code, Some([0xff, 0xcc, 0x00, 0xff]));
        assert_eq!(super::plain("100|c12|r%").text, "100|c12%");
        assert_eq!(super::plain("héllo |x").text, "héllo |x");
    }

    #[test]
    fn text_wraps_at_the_frame_width() {
        assert_eq!(broken("one two three", 1000.0, Horizontal::Left), [("one two three".into(), 0.0)]);
        assert_eq!(broken("aaa bbb ccc", 70.0, Horizontal::Left), [("aaa bbb".into(), 0.0), ("ccc".into(), 0.0)]);
        assert_eq!(broken("aaaaaaaaaaaa b", 50.0, Horizontal::Left), [("aaaaaaaaaaaa".into(), 0.0), ("b".into(), 0.0)]);
        assert_eq!(broken("a\n\nb", 0.0, Horizontal::Left), [("a".into(), 0.0), ("".into(), 0.0), ("b".into(), 0.0)]);
    }

    #[test]
    fn each_line_aligns_on_its_own() {
        assert_eq!(broken("ab\nabcd", 100.0, Horizontal::Center), [("ab".into(), 40.0), ("abcd".into(), 30.0)]);
        assert_eq!(broken("ab", 100.0, Horizontal::Right), [("ab".into(), 80.0)]);
    }

    #[test]
    fn the_block_sits_by_its_vertical_alignment() {
        assert_eq!(first_line_top(Vertical::Top, 100.0, 2, 10.0), 0.0);
        assert_eq!(first_line_top(Vertical::Middle, 100.0, 2, 10.0), 50.0 - 12.0);
        assert_eq!(first_line_top(Vertical::Bottom, 100.0, 2, 10.0), 100.0 - 24.0);
    }
}
