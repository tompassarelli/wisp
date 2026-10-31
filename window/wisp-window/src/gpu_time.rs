//! GPU time per pass from timestamp queries: each frame writes a begin and an end stamp around every pass into one query set of a ring,
//! resolves them into that slot's readback buffer, and maps it once the frame is submitted; a later frame reads the slots whose map has
//! finished, so the render thread never waits on the GPU for its own figures.

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

/// The passes a frame records, by what they draw; a frame with several passes of one kind adds their times.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Pass {
    Shadow,
    Reflection,
    Clouds,
    Sky,
    Scene,
    /// On a stage with water, the pass over the solid scene: the water and the layers, particles and weather that blend over it.
    Water,
    Post,
    Sprites,
    Ui,
    Counter,
}

pub const PASSES: [Pass; 10] = [Pass::Shadow, Pass::Reflection, Pass::Clouds, Pass::Sky, Pass::Scene, Pass::Water, Pass::Post, Pass::Sprites, Pass::Ui, Pass::Counter];

const SLOTS: usize = 4;
const QUERIES: u32 = 256;
const STAMP_BYTES: u64 = 8;

const FREE: u8 = 0;
const MAPPING: u8 = 1;
const MAPPED: u8 = 2;
const FAILED: u8 = 3;

/// One frame's stamps as its passes are encoded: hands each pass the two query indices it writes, or none when timing is off for this frame.
pub struct PassTimer {
    query_set: Option<wgpu::QuerySet>,
    slot: usize,
    passes: Vec<Pass>,
    overflowed: bool,
}

impl PassTimer {
    /// A timer that times nothing, for draws outside the window's frame.
    pub fn off() -> Self {
        Self { query_set: None, slot: 0, passes: Vec::new(), overflowed: false }
    }

    /// The stamps `pass` writes at its beginning and end.
    pub fn writes(&mut self, pass: Pass) -> Option<wgpu::RenderPassTimestampWrites<'_>> {
        let query_set = self.query_set.as_ref()?;
        let first = self.passes.len() as u32 * 2;
        if first + 2 > QUERIES {
            self.overflowed = true;
            return None;
        }
        self.passes.push(pass);
        Some(wgpu::RenderPassTimestampWrites { query_set, beginning_of_pass_write_index: Some(first), end_of_pass_write_index: Some(first + 1) })
    }
}

/// What the GPU spent on one frame: each kind of pass that ran, and the span from the first pass's beginning to the last one's end.
#[derive(Clone, Debug, PartialEq)]
pub struct FrameGpu {
    pub passes: Vec<(Pass, f64)>,
    pub span_ms: f64,
}

struct Slot {
    query_set: wgpu::QuerySet,
    resolve: wgpu::Buffer,
    readback: wgpu::Buffer,
    state: Arc<AtomicU8>,
    passes: Vec<Pass>,
    sequence: u64,
    resolved: bool,
}

/// The ring of query sets and readback buffers the window's frames take turns with.
pub struct GpuClock {
    device: wgpu::Device,
    period_ns: f64,
    slots: Vec<Slot>,
    sequence: u64,
    untimed: u64,
}

impl GpuClock {
    /// The features to ask the device for so `GpuClock::new` can time passes, of those the adapter offers.
    pub fn features(offered: wgpu::Features) -> wgpu::Features {
        offered & wgpu::Features::TIMESTAMP_QUERY
    }

    /// A clock on `device`, or why the device cannot time its passes.
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue) -> Result<Self, String> {
        if !device.features().contains(wgpu::Features::TIMESTAMP_QUERY) {
            return Err("the adapter does not offer TIMESTAMP_QUERY".to_string());
        }
        let period_ns = queue.get_timestamp_period() as f64;
        if !(period_ns > 0.0) {
            return Err(format!("the adapter's timestamp period is {period_ns} ns"));
        }
        let size = QUERIES as u64 * STAMP_BYTES;
        let slots = (0..SLOTS)
            .map(|_| Slot {
                query_set: device.create_query_set(&wgpu::QuerySetDescriptor { label: Some("pass stamps"), ty: wgpu::QueryType::Timestamp, count: QUERIES }),
                resolve: device.create_buffer(&wgpu::BufferDescriptor { label: Some("pass stamps resolved"), size, usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC, mapped_at_creation: false }),
                readback: device.create_buffer(&wgpu::BufferDescriptor { label: Some("pass stamps read"), size, usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false }),
                state: Arc::new(AtomicU8::new(FREE)),
                passes: Vec::new(),
                sequence: 0,
                resolved: false,
            })
            .collect();
        Ok(Self { device: device.clone(), period_ns, slots, sequence: 0, untimed: 0 })
    }

    /// A timer for the next frame on a free slot; with every slot still waiting on the GPU the frame goes untimed rather than wait.
    pub fn begin(&mut self) -> PassTimer {
        let free = self.slots.iter().position(|slot| slot.state.load(Ordering::Acquire) == FREE && !slot.resolved);
        match free {
            Some(index) => PassTimer { query_set: Some(self.slots[index].query_set.clone()), slot: index, passes: Vec::new(), overflowed: false },
            None => {
                self.untimed += 1;
                PassTimer::off()
            }
        }
    }

    /// Resolves the frame's stamps into its slot's readback buffer at the end of `encoder`; call `submitted` once the encoder is submitted.
    pub fn finish(&mut self, encoder: &mut wgpu::CommandEncoder, timer: PassTimer) {
        if timer.query_set.is_none() || timer.passes.is_empty() || timer.overflowed {
            return;
        }
        let slot = &mut self.slots[timer.slot];
        let count = timer.passes.len() as u32 * 2;
        encoder.resolve_query_set(&slot.query_set, 0..count, &slot.resolve, 0);
        encoder.copy_buffer_to_buffer(&slot.resolve, 0, &slot.readback, 0, count as u64 * STAMP_BYTES);
        self.sequence += 1;
        slot.passes = timer.passes;
        slot.sequence = self.sequence;
        slot.resolved = true;
    }

    /// Starts mapping the slots resolved by the frame just submitted.
    pub fn submitted(&mut self) {
        for slot in self.slots.iter_mut().filter(|slot| slot.resolved && slot.state.load(Ordering::Acquire) == FREE) {
            slot.state.store(MAPPING, Ordering::Release);
            let state = slot.state.clone();
            let bytes = slot.passes.len() as u64 * 2 * STAMP_BYTES;
            slot.readback.slice(..bytes).map_async(wgpu::MapMode::Read, move |result| state.store(if result.is_ok() { MAPPED } else { FAILED }, Ordering::Release));
        }
    }

    /// The frames whose stamps have come back since the last call, oldest first; never waits for the GPU.
    pub fn collect(&mut self) -> Vec<FrameGpu> {
        let _ = self.device.poll(wgpu::PollType::Poll);
        let mut ready: Vec<usize> = (0..self.slots.len()).filter(|&index| matches!(self.slots[index].state.load(Ordering::Acquire), MAPPED | FAILED)).collect();
        ready.sort_by_key(|&index| self.slots[index].sequence);
        let mut frames = Vec::with_capacity(ready.len());
        for index in ready {
            let slot = &mut self.slots[index];
            if slot.state.load(Ordering::Acquire) == MAPPED {
                let bytes = slot.passes.len() as u64 * 2 * STAMP_BYTES;
                if let Ok(view) = slot.readback.slice(..bytes).get_mapped_range() {
                    let stamps: Vec<u64> = view.chunks_exact(STAMP_BYTES as usize).map(|chunk| u64::from_le_bytes(chunk.try_into().expect("eight bytes"))).collect();
                    drop(view);
                    frames.extend(frame_of(&slot.passes, &stamps, self.period_ns));
                }
                slot.readback.unmap();
            }
            slot.passes.clear();
            slot.resolved = false;
            slot.state.store(FREE, Ordering::Release);
        }
        frames
    }

    /// How many frames went untimed because every slot was still waiting on the GPU.
    pub fn untimed(&self) -> u64 {
        self.untimed
    }
}

/// One frame's times from its stamps, two per pass in the order the passes ran; none when a stamp went backwards.
fn frame_of(passes: &[Pass], stamps: &[u64], period_ns: f64) -> Option<FrameGpu> {
    let to_ms = |ticks: u64| ticks as f64 * period_ns / 1e6;
    let mut sums: Vec<(Pass, f64)> = Vec::new();
    for (pass, pair) in passes.iter().zip(stamps.chunks_exact(2)) {
        let ticks = pair[1].checked_sub(pair[0])?;
        match sums.iter_mut().find(|(seen, _)| seen == pass) {
            Some((_, total)) => *total += to_ms(ticks),
            None => sums.push((*pass, to_ms(ticks))),
        }
    }
    let first = stamps.iter().step_by(2).min()?;
    let last = stamps.iter().skip(1).step_by(2).max()?;
    Some(FrameGpu { passes: sums, span_ms: to_ms(last.checked_sub(*first)?) })
}

#[cfg(test)]
mod tests;
