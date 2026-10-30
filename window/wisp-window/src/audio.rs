//! The sound output a native window plays through: one cpal stream with a buffer of at most 256 frames, fed by a mixer
//! (wisp:docs/native-window-plan.md, "Sound"). A machine with no output device mixes at the same pace into nothing, so a run still
//! counts its sounds and `info` says which output it had.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, sync_channel, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, FromSample, SampleFormat, SizedSample, SupportedBufferSize};

use crate::decode::{decode, Clip};
use crate::mixer::{Mixer, Voice};

pub const BUFFER_FRAMES: u32 = 256;
const SILENT_RATE: u32 = 48_000;
const SILENT_CHANNELS: u16 = 2;

struct Output {
    kind: String,
    channels: u16,
    rate: u32,
    buffer_frames: u32,
}

type Voices = Arc<Mutex<Receiver<Voice>>>;

fn drain(voices: &Voices, mixer: &mut Mixer) {
    if let Ok(voices) = voices.try_lock() {
        while let Ok(voice) = voices.try_recv() {
            mixer.start(voice);
        }
    }
}

fn device_stream<T: SizedSample + FromSample<f32>>(device: &cpal::Device, config: cpal::StreamConfig, voices: Voices) -> Result<cpal::Stream, String> {
    let mut mixer = Mixer::new(config.channels, config.sample_rate);
    let mut scratch = Vec::<f32>::new();
    device
        .build_output_stream::<T, _, _>(
            config,
            move |data, _| {
                drain(&voices, &mut mixer);
                scratch.resize(data.len(), 0.0);
                mixer.render(&mut scratch);
                for (out, mixed) in data.iter_mut().zip(&scratch) {
                    *out = T::from_sample(*mixed);
                }
            },
            |_| {},
            None,
        )
        .map_err(|error| error.to_string())
}

fn open_device(voices: Voices) -> Result<(cpal::Stream, Output), String> {
    let device = cpal::default_host().default_output_device().ok_or("no output device")?;
    let supported = device.default_output_config().map_err(|error| error.to_string())?;
    let mut config = supported.config();
    let buffer_frames = match supported.buffer_size() {
        SupportedBufferSize::Range { min, max } => BUFFER_FRAMES.clamp(*min, *max),
        SupportedBufferSize::Unknown => BUFFER_FRAMES,
    };
    config.buffer_size = BufferSize::Fixed(buffer_frames);
    let (channels, rate, format) = (config.channels, config.sample_rate, supported.sample_format());
    let stream = match format {
        SampleFormat::F32 => device_stream::<f32>(&device, config, voices),
        SampleFormat::I16 => device_stream::<i16>(&device, config, voices),
        SampleFormat::U16 => device_stream::<u16>(&device, config, voices),
        SampleFormat::I32 => device_stream::<i32>(&device, config, voices),
        other => Err(format!("{other:?} output isn't supported")),
    }?;
    stream.play().map_err(|error| error.to_string())?;
    let name = device.description().map(|description| description.to_string()).unwrap_or_else(|_| "the default device".into());
    Ok((stream, Output { kind: format!("{name} ({format:?})"), channels, rate, buffer_frames }))
}

fn mix_into_nothing(voices: &Voices, stop: &Receiver<()>) {
    let mut mixer = Mixer::new(SILENT_CHANNELS, SILENT_RATE);
    let mut scratch = vec![0.0; BUFFER_FRAMES as usize * SILENT_CHANNELS as usize];
    let period = Duration::from_secs_f64(BUFFER_FRAMES as f64 / SILENT_RATE as f64);
    while let Err(RecvTimeoutError::Timeout) = stop.recv_timeout(period) {
        drain(voices, &mut mixer);
        mixer.render(&mut scratch);
    }
}

fn serve(voices: Voices, stop: Receiver<()>, ready: SyncSender<Output>) {
    match open_device(voices.clone()) {
        Ok((stream, output)) => {
            let _ = ready.send(output);
            let _ = stop.recv();
            drop(stream);
        }
        Err(reason) => {
            let _ = ready.send(Output { kind: format!("none ({reason})"), channels: SILENT_CHANNELS, rate: SILENT_RATE, buffer_frames: BUFFER_FRAMES });
            mix_into_nothing(&voices, &stop);
        }
    }
}

pub struct Audio {
    clips: Mutex<HashMap<String, Arc<Clip>>>,
    voices: Sender<Voice>,
    stop: Sender<()>,
    thread: Option<JoinHandle<()>>,
    output: Output,
    decoded: AtomicU64,
    started: AtomicU64,
}

impl Audio {
    pub fn open() -> Audio {
        let (voices_in, voices_out) = channel();
        let (stop_in, stop_out) = channel();
        let (ready_in, ready_out) = sync_channel(1);
        let voices = Arc::new(Mutex::new(voices_out));
        let thread = thread::spawn(move || serve(voices, stop_out, ready_in));
        let output = ready_out.recv().unwrap_or(Output { kind: "none (the audio thread failed)".into(), channels: 0, rate: 0, buffer_frames: 0 });
        Audio { clips: Mutex::new(HashMap::new()), voices: voices_in, stop: stop_in, thread: Some(thread), output, decoded: AtomicU64::new(0), started: AtomicU64::new(0) }
    }

    fn clips(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Clip>>> {
        self.clips.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Decodes `bytes` once under `key`; a key already loaded is left as it is, which is how sounds are reused by resolved path.
    pub fn load(&self, key: &str, bytes: &[u8]) -> Result<(), String> {
        if self.clips().contains_key(key) {
            return Ok(());
        }
        let clip = decode(bytes).map_err(|error| format!("{key}: {error}"))?;
        if self.clips().insert(key.to_owned(), Arc::new(clip)).is_none() {
            self.decoded.fetch_add(1, Ordering::Relaxed);
        }
        Ok(())
    }

    pub fn play(&self, key: &str, volume: f64, pitch: f64) -> bool {
        let Some(clip) = self.clips().get(key).cloned() else { return false };
        if self.voices.send(Voice::new(clip, volume, pitch)).is_err() {
            return false;
        }
        self.started.fetch_add(1, Ordering::Relaxed);
        true
    }

    pub fn info(&self) -> String {
        serde_json::json!({
            "output": self.output.kind, "channels": self.output.channels, "sampleRate": self.output.rate,
            "bufferFrames": self.output.buffer_frames, "decoded": self.decoded.load(Ordering::Relaxed), "started": self.started.load(Ordering::Relaxed),
        })
        .to_string()
    }
}

impl Drop for Audio {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
