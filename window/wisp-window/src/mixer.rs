//! Mixes started sounds into an output buffer: volume is `volume / 127` and pitch is a playback-rate change done by linear resampling,
//! as WebAudio's `playbackRate` does (wisp:host/browser/standalone.ts).

use std::sync::Arc;

use crate::decode::Clip;

pub const MAX_VOICES: usize = 64;

pub struct Voice {
    pub clip: Arc<Clip>,
    pub gain: f32,
    pub pitch: f64,
}

impl Voice {
    pub fn new(clip: Arc<Clip>, volume: f64, pitch: f64) -> Voice {
        Voice { clip, gain: (volume / 127.0).clamp(0.0, 1.0) as f32, pitch: pitch.max(0.01) }
    }
}

struct Playing {
    voice: Voice,
    position: f64,
    step: f64,
}

pub struct Mixer {
    channels: usize,
    rate: u32,
    playing: Vec<Playing>,
}

impl Mixer {
    pub fn new(channels: u16, rate: u32) -> Mixer {
        Mixer { channels: channels.max(1) as usize, rate, playing: Vec::with_capacity(MAX_VOICES) }
    }

    pub fn start(&mut self, voice: Voice) {
        if self.playing.len() == MAX_VOICES {
            self.playing.remove(0);
        }
        let step = voice.clip.rate as f64 / self.rate as f64 * voice.pitch;
        self.playing.push(Playing { voice, position: 0.0, step });
    }

    pub fn render(&mut self, out: &mut [f32]) {
        out.fill(0.0);
        let channels = self.channels;
        self.playing.retain_mut(|playing| {
            let clip = &playing.voice.clip;
            let source = clip.channels as usize;
            let frames = clip.frames();
            for frame in out.chunks_exact_mut(channels) {
                let index = playing.position as usize;
                if index >= frames {
                    return false;
                }
                let next = (index + 1).min(frames - 1);
                let fraction = (playing.position - index as f64) as f32;
                let at = |frame_index: usize, channel: usize| clip.samples[frame_index * source + channel];
                for (channel, slot) in frame.iter_mut().enumerate() {
                    let from = if source == 1 { 0 } else { channel.min(source - 1) };
                    let a = at(index, from);
                    *slot += (a + (at(next, from) - a) * fraction) * playing.voice.gain;
                }
                playing.position += playing.step;
            }
            (playing.position as usize) < frames
        });
        for sample in out.iter_mut() {
            *sample = sample.clamp(-1.0, 1.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(rate: u32, frames: usize) -> Arc<Clip> {
        Arc::new(Clip { channels: 1, rate, samples: (0..frames).map(|index| index as f32 / frames as f32).collect() })
    }

    #[test]
    fn volume_is_over_127_and_clamped() {
        assert_eq!(Voice::new(ramp(8, 8), 127.0, 1.0).gain, 1.0);
        assert_eq!(Voice::new(ramp(8, 8), 200.0, 1.0).gain, 1.0);
        assert_eq!(Voice::new(ramp(8, 8), -5.0, 1.0).gain, 0.0);
        assert!((Voice::new(ramp(8, 8), 63.5, 1.0).gain - 0.5).abs() < 1e-6);
    }

    #[test]
    fn resampling_interpolates_linearly() {
        let mut mixer = Mixer::new(1, 16);
        mixer.start(Voice::new(Arc::new(Clip { channels: 1, rate: 8, samples: vec![0.0, 1.0, 0.0] }), 127.0, 1.0));
        let mut out = [0.0; 6];
        mixer.render(&mut out);
        assert_eq!(out, [0.0, 0.5, 1.0, 0.5, 0.0, 0.0]);
    }

}
