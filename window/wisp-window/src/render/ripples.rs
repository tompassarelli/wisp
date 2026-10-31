//! What a body does to the water it stands in: the renderer finds each solid model that crosses the water plane, follows it from one game frame to the next,
//! and hands the water pass up to `SOURCES` of them as rings to draw. A body at rest sends rings outward, a moving one drags a wake, and one that enters or leaves
//! the plane sends a burst that expands and fades. Nothing here reads the game's state, only the poses the scene draws, so the game's digests cannot change.

use std::collections::HashMap;

use super::math::Mat4;

/// How many sources the water pass draws, bursts first then bodies; each takes two vec4s of the water uniform.
pub const SOURCES: usize = 16;
const BURSTS: usize = 8;
/// Seconds a burst lasts.
pub const BURST_LIFE: f32 = 1.9;
/// A model wider than this across the plane is a deck or a shore, not a body.
const LARGEST_BODY: f32 = 700.0;
const FRAMES_PER_SECOND: f32 = 60.0;
const SMOOTHING: f32 = 0.35;
/// A body that moves further than this in one second between two game frames was placed, not carried: a pooled effect unparked, a fighter respawned.
const FASTEST_BODY: f32 = 6000.0;

/// A solid model's box in its own coordinates, minimum corner then maximum.
pub type Extent = [f32; 6];

pub fn extent_of(positions: impl Iterator<Item = [f32; 3]>) -> Option<Extent> {
    let mut extent = [f32::MAX, f32::MAX, f32::MAX, f32::MIN, f32::MIN, f32::MIN];
    let mut any = false;
    for point in positions {
        any = true;
        for axis in 0..3 {
            extent[axis] = extent[axis].min(point[axis]);
            extent[3 + axis] = extent[3 + axis].max(point[axis]);
        }
    }
    any.then_some(extent)
}

/// A model placed in the world, as the renderer draws it.
pub struct Placement<'a> {
    pub id: u32,
    pub model: &'a str,
    pub matrix: Mat4,
    pub alpha: f32,
}

/// Where a body stands at the plane and how far it reaches there.
struct Body {
    id: u32,
    centre: [f32; 3],
    radius: f32,
    low: f32,
    high: f32,
}

/// The box of `extent` placed by the pose's matrix, as the body it makes at the plane; None for a model too wide to be one.
fn body_of(pose: &Placement, extent: &Extent) -> Option<Body> {
    let m: &Mat4 = &pose.matrix;
    let mut low = [f32::MAX; 3];
    let mut high = [f32::MIN; 3];
    for corner in 0..8 {
        let local = [if corner & 1 == 0 { extent[0] } else { extent[3] }, if corner & 2 == 0 { extent[1] } else { extent[4] }, if corner & 4 == 0 { extent[2] } else { extent[5] }];
        for axis in 0..3 {
            let world = m[axis] * local[0] + m[4 + axis] * local[1] + m[8 + axis] * local[2] + m[12 + axis];
            low[axis] = low[axis].min(world);
            high[axis] = high[axis].max(world);
        }
    }
    let width = (high[0] - low[0]).max(high[1] - low[1]);
    (pose.alpha > 0.05 && (1.0..=LARGEST_BODY).contains(&width)).then(|| Body { id: pose.id, centre: [(low[0] + high[0]) * 0.5, (low[1] + high[1]) * 0.5, (low[2] + high[2]) * 0.5], radius: (width * 0.3).clamp(24.0, 150.0), low: low[2], high: high[2] })
}

fn distance(a: &[f32; 3], b: &[f32; 3]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// One thing the water pass draws rings for: `at` is x, y, the ring radius and a burst's birth second; `motion` is the velocity in x and y, the strength and the kind (0 a body, 1 an entry, 2 an exit).
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct Source {
    pub at: [f32; 4],
    pub motion: [f32; 4],
}

struct Track {
    centre: [f32; 3],
    velocity: [f32; 3],
    wet: bool,
}

#[derive(Default)]
pub struct Ripples {
    tracks: HashMap<u32, Track>,
    bursts: Vec<Source>,
    last_frame: Option<u32>,
    bodies: Vec<Source>,
}

impl Ripples {
    /// Follows the bodies crossing `plane` to the game frame `frame`, at renderer second `seconds`; called every drawn frame, it only advances when the game has.
    pub fn follow<'a>(&mut self, placed: impl Iterator<Item = Placement<'a>>, extent_of: impl Fn(&str) -> Option<Extent>, plane: f32, frame: u32, seconds: f32) {
        self.bursts.retain(|burst| seconds - burst.at[3] < BURST_LIFE);
        let step = match self.last_frame {
            Some(last) if frame == last => return,
            Some(last) if frame > last && frame - last <= 12 => Some((frame - last) as f32 / FRAMES_PER_SECOND),
            _ => None,
        };
        self.last_frame = Some(frame);
        if step.is_none() {
            self.tracks.clear();
            self.bursts.clear();
        }
        self.bodies.clear();
        let mut seen = Vec::new();
        for (index, pose) in placed.enumerate() {
            let Some(body) = extent_of(pose.model).and_then(|extent| body_of(&pose, &extent)) else { continue };
            let key = if body.id != 0 { body.id } else { 0x8000_0000 | index as u32 };
            seen.push(key);
            self.observe(key, &body, plane, step, seconds);
        }
        self.tracks.retain(|key, _| seen.contains(key));
        if self.bursts.len() > BURSTS {
            let surplus = self.bursts.len() - BURSTS;
            self.bursts.drain(..surplus);
        }
    }

    /// Takes one body's step: its velocity from where it was, a burst if it crossed the plane, and its own rings if it stands in the water.
    fn observe(&mut self, key: u32, body: &Body, plane: f32, step: Option<f32>, seconds: f32) {
        let wet = body.low < plane;
        let (velocity, was_wet) = match (self.tracks.get(&key), step) {
            (Some(track), Some(dt)) if distance(&track.centre, &body.centre) <= FASTEST_BODY * dt => {
                let measured = [0, 1, 2].map(|axis| (body.centre[axis] - track.centre[axis]) / dt);
                ([0, 1, 2].map(|axis| track.velocity[axis] + (measured[axis] - track.velocity[axis]) * SMOOTHING), track.wet)
            }
            _ => ([0.0; 3], wet),
        };
        if wet != was_wet {
            let strength = (0.55 + velocity[2].abs().max(body.radius * 4.0) / 1400.0).clamp(0.6, 1.5);
            self.bursts.push(Source { at: [body.centre[0], body.centre[1], body.radius, seconds], motion: [velocity[0], velocity[1], strength, if wet { 1.0 } else { 2.0 }] });
        }
        if wet && body.high > plane && self.bodies.len() < SOURCES {
            self.bodies.push(Source { at: [body.centre[0], body.centre[1], body.radius, 0.0], motion: [velocity[0], velocity[1], 1.0, 0.0] });
        }
        self.tracks.insert(key, Track { centre: body.centre, velocity, wet });
    }

    /// The sources to draw: bursts first since they are brief, then bodies, at most `SOURCES`.
    pub fn sources(&self) -> Vec<Source> {
        self.bursts.iter().rev().chain(self.bodies.iter()).take(SOURCES).copied().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::math::IDENTITY;

    fn pose(id: u32, z: f32) -> std::iter::Once<Placement<'static>> {
        let mut matrix = IDENTITY;
        matrix[14] = z;
        std::iter::once(Placement { id, model: "fighter", matrix, alpha: 1.0 })
    }

    fn fighter(_: &str) -> Option<Extent> {
        Some([-40.0, -30.0, 0.0, 40.0, 30.0, 220.0])
    }

    #[test]
    fn a_body_crossing_the_plane_sends_one_entry_burst_and_one_exit_burst() {
        let mut ripples = Ripples::default();
        ripples.follow(pose(7, 300.0), fighter, 0.0, 100, 1.0);
        assert!(ripples.sources().is_empty(), "a fighter above the water draws nothing");
        ripples.follow(pose(7, -60.0), fighter, 0.0, 112, 1.02);
        let entered = ripples.sources();
        assert_eq!(entered.iter().filter(|source| source.motion[3] == 1.0).count(), 1);
        assert_eq!(entered.iter().filter(|source| source.motion[3] == 0.0).count(), 1, "the wading body keeps its own rings");
        ripples.follow(pose(7, -60.0), fighter, 0.0, 112, 1.03);
        assert_eq!(ripples.sources(), entered, "a repeated game frame changes nothing");
        ripples.follow(pose(7, 400.0), fighter, 0.0, 124, 1.05);
        assert_eq!(ripples.sources().iter().filter(|source| source.motion[3] == 2.0).count(), 1);
        ripples.follow(pose(7, 400.0), fighter, 0.0, 136, 4.0);
        assert!(ripples.sources().is_empty(), "bursts fade after {BURST_LIFE} s");
    }

    #[test]
    fn a_body_that_is_placed_across_the_surface_in_one_frame_makes_no_splash() {
        let mut ripples = Ripples::default();
        ripples.follow(pose(9, -5000.0), fighter, 0.0, 10, 0.5);
        ripples.follow(pose(9, 400.0), fighter, 0.0, 11, 0.6);
        ripples.follow(pose(9, -60.0), fighter, 0.0, 12, 0.7);
        assert!(ripples.sources().iter().all(|source| source.motion[3] == 0.0), "{:?}", ripples.sources());
    }

    #[test]
    fn a_pillar_standing_in_the_water_has_rings_but_no_splash_and_a_deck_has_neither() {
        let mut ripples = Ripples::default();
        ripples.follow(pose(0, -100.0), fighter, 0.0, 10, 0.5);
        let sources = ripples.sources();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].motion[3], 0.0);
        ripples.follow(pose(0, -100.0), |_| Some([-900.0, -250.0, -160.0, 900.0, 250.0, 30.0]), 0.0, 11, 0.6);
        assert!(ripples.sources().is_empty());
    }
}
