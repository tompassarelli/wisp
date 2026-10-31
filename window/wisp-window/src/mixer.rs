//! Mixes started sounds into an output buffer: volume is `volume / 127` and pitch is a playback-rate change done by linear resampling,
//! as WebAudio's `playbackRate` does (wisp:host/browser/standalone.ts).

use std::sync::Arc;

use crate::decode::Clip;

pub const MAX_VOICES: usize = 64;

pub struct Voice {
    pub clip: Arc<Clip>,
    pub owner: String,
    pub gain: f32,
    pub pitch: f64,
    pub looping: bool,
}

impl Voice {
    pub fn new(clip: Arc<Clip>, owner: &str, volume: f64, pitch: f64, looping: bool) -> Voice {
        Voice { clip, owner: owner.to_owned(), gain: (volume / 127.0).clamp(0.0, 1.0) as f32, pitch: pitch.max(0.01), looping }
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

    /// Ends every voice `owner` started, as a stop cue ends its handle's sound.
    pub fn stop(&mut self, owner: &str) {
        self.playing.retain(|playing| playing.voice.owner != owner);
    }

    pub fn render(&mut self, out: &mut [f32]) {
        out.fill(0.0);
        let channels = self.channels;
        self.playing.retain_mut(|playing| {
            let clip = &playing.voice.clip;
            let source = clip.channels as usize;
            let frames = clip.frames();
            for frame in out.chunks_exact_mut(channels) {
                if playing.voice.looping && frames > 0 {
                    playing.position %= frames as f64;
                }
                let index = playing.position as usize;
                if index >= frames {
                    return false;
                }
                let next = if playing.voice.looping { (index + 1) % frames } else { (index + 1).min(frames - 1) };
                let fraction = (playing.position - index as f64) as f32;
                let at = |frame_index: usize, channel: usize| clip.samples[frame_index * source + channel];
                for (channel, slot) in frame.iter_mut().enumerate() {
                    let from = if source == 1 { 0 } else { channel.min(source - 1) };
                    let a = at(index, from);
                    *slot += (a + (at(next, from) - a) * fraction) * playing.voice.gain;
                }
                playing.position += playing.step;
            }
            (playing.voice.looping && frames > 0) || (playing.position as usize) < frames
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
        assert_eq!(Voice::new(ramp(8, 8), "s", 127.0, 1.0, false).gain, 1.0);
        assert_eq!(Voice::new(ramp(8, 8), "s", 200.0, 1.0, false).gain, 1.0);
        assert_eq!(Voice::new(ramp(8, 8), "s", -5.0, 1.0, false).gain, 0.0);
        assert!((Voice::new(ramp(8, 8), "s", 63.5, 1.0, false).gain - 0.5).abs() < 1e-6);
    }

    #[test]
    fn resampling_interpolates_linearly() {
        let mut mixer = Mixer::new(1, 16);
        mixer.start(Voice::new(Arc::new(Clip { channels: 1, rate: 8, samples: vec![0.0, 1.0, 0.0] }), "s", 127.0, 1.0, false));
        let mut out = [0.0; 6];
        mixer.render(&mut out);
        assert_eq!(out, [0.0, 0.5, 1.0, 0.5, 0.0, 0.0]);
    }

    #[test]
    fn a_looping_voice_wraps_until_its_owner_stops_it() {
        let clip = Arc::new(Clip { channels: 1, rate: 8, samples: vec![0.25, 0.5] });
        let mut mixer = Mixer::new(1, 8);
        mixer.start(Voice::new(clip.clone(), "music", 127.0, 1.0, true));
        mixer.start(Voice::new(clip, "sound:4", 127.0, 1.0, false));
        let mut out = [0.0; 6];
        mixer.render(&mut out);
        assert_eq!(out, [0.5, 1.0, 0.25, 0.5, 0.25, 0.5]);
        assert_eq!(mixer.playing.len(), 1);
        mixer.stop("music");
        mixer.render(&mut out);
        assert_eq!(out, [0.0; 6]);
        assert!(mixer.playing.is_empty());
    }

}
