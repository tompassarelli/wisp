use super::pose::Playhead;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineType {
    DontInterp,
    Linear,
    Hermite,
    Bezier,
}

impl LineType {
    pub(crate) fn from_code(code: i32) -> Option<Self> {
        match code {
            0 => Some(Self::DontInterp),
            1 => Some(Self::Linear),
            2 => Some(Self::Hermite),
            3 => Some(Self::Bezier),
            _ => None,
        }
    }

    pub(crate) fn has_tangents(self) -> bool {
        matches!(self, Self::Hermite | Self::Bezier)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Key<const N: usize> {
    pub frame: i32,
    pub value: [f32; N],
    pub in_tan: [f32; N],
    pub out_tan: [f32; N],
}

/// An animated value: keys sorted by frame, read in a sequence's interval or on a global sequence's clock.
#[derive(Clone, Debug, PartialEq)]
pub struct Track<const N: usize> {
    pub line: LineType,
    pub global_sequence: Option<usize>,
    pub keys: Vec<Key<N>>,
}

impl<const N: usize> Track<N> {
    pub(crate) fn new(line: LineType) -> Self {
        Self { line, global_sequence: None, keys: Vec::new() }
    }

    /// The keys around the playhead, or `None` when the track has no key in the sequence (so the node keeps its rest value).
    fn bracket(&self, playhead: &Playhead) -> Option<(&Key<N>, &Key<N>, f32)> {
        let (frame, from, to) = playhead.window(self.global_sequence);
        let keys = &self.keys;
        if keys.is_empty() || keys[0].frame as f32 > to || (keys[keys.len() - 1].frame as f32) < from {
            return None;
        }
        let first = keys.partition_point(|key| key.frame as f32 <= frame);
        let before = first.checked_sub(1).map(|index| &keys[index]).filter(|key| key.frame as f32 >= from);
        let after = keys.get(first).filter(|key| key.frame as f32 <= to);
        match (before, after) {
            (Some(left), Some(right)) => Some((left, right, frame)),
            (Some(only), None) | (None, Some(only)) => Some((only, only, frame)),
            (None, None) => None,
        }
    }

    fn factor(&self, left: &Key<N>, right: &Key<N>, frame: f32) -> Option<f32> {
        (left.frame != right.frame).then(|| (frame - left.frame as f32) / (right.frame - left.frame) as f32)
    }
}

impl<const N: usize> Track<N> {
    pub fn left_key(&self, playhead: &Playhead) -> Option<&Key<N>> {
        self.bracket(playhead).map(|(left, _, _)| left)
    }

    pub fn vector(&self, playhead: &Playhead) -> Option<[f32; N]> {
        let (left, right, frame) = self.bracket(playhead)?;
        let Some(t) = self.factor(left, right, frame) else { return Some(left.value) };
        Some(match self.line {
            LineType::DontInterp => left.value,
            LineType::Linear => std::array::from_fn(|i| left.value[i] + t * (right.value[i] - left.value[i])),
            LineType::Hermite => {
                let f = hermite_weights(t);
                std::array::from_fn(|i| left.value[i] * f[0] + left.out_tan[i] * f[1] + right.in_tan[i] * f[2] + right.value[i] * f[3])
            }
            LineType::Bezier => {
                let f = bezier_weights(t);
                std::array::from_fn(|i| left.value[i] * f[0] + left.out_tan[i] * f[1] + right.in_tan[i] * f[2] + right.value[i] * f[3])
            }
        })
    }
}

impl Track<4> {
    pub fn quaternion(&self, playhead: &Playhead) -> Option<[f32; 4]> {
        let (left, right, frame) = self.bracket(playhead)?;
        let Some(t) = self.factor(left, right, frame) else { return Some(left.value) };
        Some(match self.line {
            LineType::DontInterp => left.value,
            LineType::Linear => slerp(left.value, right.value, t),
            LineType::Hermite | LineType::Bezier => {
                let a = slerp(left.value, right.value, t);
                let b = slerp(left.out_tan, right.in_tan, t);
                slerp(a, b, 2.0 * t * (1.0 - t))
            }
        })
    }
}

fn hermite_weights(t: f32) -> [f32; 4] {
    let squared = t * t;
    [squared * (2.0 * t - 3.0) + 1.0, squared * (t - 2.0) + t, squared * (t - 1.0), squared * (3.0 - 2.0 * t)]
}

fn bezier_weights(t: f32) -> [f32; 4] {
    let inverse = 1.0 - t;
    let inverse_squared = inverse * inverse;
    let squared = t * t;
    [inverse_squared * inverse, 3.0 * t * inverse_squared, 3.0 * squared * inverse, squared * t]
}

fn slerp(a: [f32; 4], mut b: [f32; 4], t: f32) -> [f32; 4] {
    let mut cosine: f32 = a.iter().zip(&b).map(|(x, y)| x * y).sum();
    if cosine < 0.0 {
        cosine = -cosine;
        b = b.map(|value| -value);
    }
    let (left, right) = if 1.0 - cosine > 1e-6 {
        let angle = cosine.acos();
        let sine = angle.sin();
        (((1.0 - t) * angle).sin() / sine, (t * angle).sin() / sine)
    } else {
        (1.0 - t, t)
    };
    std::array::from_fn(|i| left * a[i] + right * b[i])
}

/// Wisp's track read (host/browser/headlessRender.ts `sample`): the first key before the track starts, the last after it ends,
/// the earlier key on a `DontInterp` track, otherwise a linear blend of the two keys around `frame`, whatever the line type.
pub fn sample<const N: usize>(track: Option<&Track<N>>, frame: f32, fallback: [f32; N]) -> [f32; N] {
    let Some(track) = track else { return fallback };
    let (Some(first), Some(last)) = (track.keys.first(), track.keys.last()) else { return fallback };
    if frame <= first.frame as f32 {
        return first.value;
    }
    for pair in track.keys.windows(2) {
        let (before, after) = (&pair[0], &pair[1]);
        if frame >= after.frame as f32 {
            continue;
        }
        if track.line == LineType::DontInterp {
            return before.value;
        }
        let t = (frame - before.frame as f32) / (after.frame - before.frame) as f32;
        return std::array::from_fn(|i| before.value[i] + (after.value[i] - before.value[i]) * t);
    }
    last.value
}

/// Rotates `v` by `q`, normalising `q` first and reading a zero quaternion as unit length, as Wisp's `rotate` does.
pub fn rotate(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let length = q.iter().map(|c| c * c).sum::<f32>().sqrt();
    let length = if length == 0.0 { 1.0 } else { length };
    let [x, y, z, w] = q.map(|c| c / length);
    let [vx, vy, vz] = v;
    let (tx, ty, tz) = (2.0 * (y * vz - z * vy), 2.0 * (z * vx - x * vz), 2.0 * (x * vy - y * vx));
    [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)]
}

/// The frame a global sequence of `length` milliseconds shows at `clock_seconds` (src/game/native/animation.ts).
pub fn global_sequence_frame(clock_seconds: f32, length: u32) -> u32 {
    if length == 0 {
        return 0;
    }
    ((clock_seconds * 1000.0).floor() as i64).rem_euclid(i64::from(length)) as u32
}
