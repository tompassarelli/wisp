//! Version-1 particle emitters (`PREM`), whose particles are whole models (wisp:docs/native-window-plan.md, "Version-1 emitters").
//!
//! Each particle is a pose of the emitted model, born at the emitter's node with a speed along a direction tilted from the node's Z axis
//! by up to its latitude and turned at random about Z, then pulled down by gravity until its life runs out. It plays the model's first
//! sequence from its start. The poses are drawn by the model path with the scene's own, so all copies of one model are one instanced draw.

use std::collections::HashMap;

use super::emission::Tick;
use super::math::{Mat4, IDENTITY};
use super::model::{ModelSpawner, SpawnerSample};
use super::scene::Pose;

const LIVE: usize = 512;
const BORN_PER_STEP: u32 = 16;
const PARKED_SCALE: f32 = 1e-3;
/// Handles for the drawn copies, above any game handle, so their own emitters run apart from every scene pose.
const FIRST_ID: u32 = 0xC000_0000;

#[derive(Clone, Copy)]
struct Flight {
    origin: [f32; 3],
    velocity: [f32; 3],
    gravity: f32,
    birth: f32,
    life: f32,
    turn: [f32; 2],
    scale: f32,
}

#[derive(Default)]
struct Running {
    owed: f32,
    seen: u64,
}

#[derive(Default)]
pub(super) struct Spawned {
    poses: Vec<Pose>,
    flights: Vec<Flight>,
    running: HashMap<(u32, u32), Running>,
    generation: u64,
    tick: Tick,
    next_id: u32,
    random: u64,
    pub(super) problems: Vec<String>,
}

impl Spawned {
    pub(super) fn new() -> Self {
        Self { random: 0x2545_F491_4F6C_DD1D, ..Self::default() }
    }

    /// Starts a scene at `tick`, dropping the emitters the last scene did not pose; a restarted clock drops every copy in flight.
    pub(super) fn begin(&mut self, tick: Tick) {
        let last = self.generation;
        self.running.retain(|_, state| state.seen == last);
        self.generation += 1;
        self.tick = tick;
        if tick.restarted {
            self.poses.clear();
            self.flights.clear();
            self.running.clear();
        }
    }

    fn random(&mut self, low: f32, high: f32) -> f32 {
        self.random ^= self.random << 13;
        self.random ^= self.random >> 7;
        self.random ^= self.random << 17;
        low + (high - low) * ((self.random >> 40) as f32 / (1u64 << 24) as f32)
    }

    /// Births the copies emitter `index` of the pose `parent` owes for the time since the last scene; `world` places its node in the world.
    pub(super) fn emit(&mut self, index: usize, spawner: &ModelSpawner, sample: &SpawnerSample, world: &Mat4, parent: &Pose) {
        let state = self.running.entry((parent.id, index as u32)).or_default();
        state.seen = self.generation;
        let Tick { now, step, .. } = self.tick;
        let scale = (world[0] * world[0] + world[1] * world[1] + world[2] * world[2]).sqrt();
        if !sample.visible || step <= 0.0 || scale < PARKED_SCALE || sample.life <= 0.0 {
            return;
        }
        state.owed += sample.rate * step;
        let due = (state.owed as u32).min(BORN_PER_STEP);
        state.owed = (state.owed - due as f32).min(1.0);
        let origin: [f32; 3] = std::array::from_fn(|row| world[row] * spawner.pivot[0] + world[4 + row] * spawner.pivot[1] + world[8 + row] * spawner.pivot[2] + world[12 + row]);
        for born in 0..due {
            if self.flights.len() >= LIVE {
                self.problems.push(format!("more than {LIVE} version-1 particles in flight; {} is not drawn", spawner.path));
                return;
            }
            let lean = self.random(-sample.latitude, sample.latitude);
            let spin = self.random(-std::f32::consts::PI, std::f32::consts::PI);
            let yaw = self.random(0.0, std::f32::consts::TAU);
            let local = [lean.sin() * spin.cos() * sample.speed, lean.sin() * spin.sin() * sample.speed, lean.cos() * sample.speed];
            let velocity = std::array::from_fn(|row| world[row] * local[0] + world[4 + row] * local[1] + world[8 + row] * local[2]);
            let birth = now - step * (1.0 - (born as f32 + 0.5) / due as f32);
            self.flights.push(Flight { origin, velocity, gravity: sample.gravity * scale, birth, life: sample.life, turn: [yaw.cos(), yaw.sin()], scale });
            self.next_id = self.next_id.wrapping_add(1);
            self.poses.push(Pose { id: FIRST_ID | (self.next_id & !FIRST_ID), model: spawner.path.clone(), matrix: IDENTITY, sequence: 0, frame: 0.0, clock: parent.clock, alpha: parent.alpha, color: parent.color, team: parent.team, unit: false });
        }
    }

    /// Drops the copies whose life is over, and moves the rest to where they fly now. `interval` gives a model's first sequence.
    pub(super) fn advance(&mut self, interval: impl Fn(&str) -> Option<[u32; 2]>) {
        let now = self.tick.now;
        let mut at = 0;
        while at < self.flights.len() {
            let flight = self.flights[at];
            let age = now - flight.birth;
            if age >= flight.life {
                self.flights.swap_remove(at);
                self.poses.swap_remove(at);
                continue;
            }
            let age = age.max(0.0);
            let place: [f32; 3] = std::array::from_fn(|axis| flight.origin[axis] + flight.velocity[axis] * age);
            let [cos, sin] = flight.turn;
            let size = flight.scale;
            let pose = &mut self.poses[at];
            pose.matrix = [cos * size, sin * size, 0.0, 0.0, -sin * size, cos * size, 0.0, 0.0, 0.0, 0.0, size, 0.0, place[0], place[1], place[2] - 0.5 * flight.gravity * age * age, 1.0];
            pose.frame = interval(&pose.model).map_or(0.0, |[start, end]| start as f32 + if end > start { (age * 1000.0) % (end - start) as f32 } else { 0.0 });
            at += 1;
        }
    }

    /// Takes the poses out while the scene is laid out beside them, so births during the layout land in a fresh list; `restore` puts them back first.
    pub(super) fn take(&mut self) -> Vec<Pose> {
        std::mem::take(&mut self.poses)
    }

    pub(super) fn restore(&mut self, mut poses: Vec<Pose>) {
        poses.append(&mut self.poses);
        self.poses = poses;
    }
}
