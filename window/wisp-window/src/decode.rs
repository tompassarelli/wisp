//! Sound files to interleaved f32 samples. Warcraft's stock sounds are Vorbis, its music MP3, and Smashcraft's own sounds FLAC;
//! `hound` reads the PCM and float WAVs the resolver may also reach (wisp:docs/native-window-plan.md, "Sound").

use std::io::Cursor;

pub struct Clip {
    pub channels: u16,
    pub rate: u32,
    pub samples: Vec<f32>,
}

impl Clip {
    pub fn frames(&self) -> usize {
        self.samples.len() / self.channels.max(1) as usize
    }
}

pub fn decode(bytes: &[u8]) -> Result<Clip, String> {
    let clip = if bytes.starts_with(b"fLaC") {
        flac(bytes)?
    } else if bytes.starts_with(b"OggS") {
        vorbis(bytes)?
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        wav(bytes)?
    } else {
        mpeg(bytes)?
    };
    if clip.channels == 0 || clip.rate == 0 || clip.samples.is_empty() {
        return Err("the file holds no audio".into());
    }
    Ok(clip)
}

fn flac(bytes: &[u8]) -> Result<Clip, String> {
    let mut reader = claxon::FlacReader::new(Cursor::new(bytes)).map_err(|error| format!("flac: {error}"))?;
    let info = reader.streaminfo();
    let scale = 1.0 / (1u64 << (info.bits_per_sample - 1)) as f32;
    let samples = reader.samples().map(|sample| sample.map(|value| value as f32 * scale)).collect::<Result<Vec<_>, _>>().map_err(|error| format!("flac: {error}"))?;
    Ok(Clip { channels: info.channels as u16, rate: info.sample_rate, samples })
}

fn vorbis(bytes: &[u8]) -> Result<Clip, String> {
    let mut reader = lewton::inside_ogg::OggStreamReader::new(Cursor::new(bytes)).map_err(|error| format!("vorbis: {error}"))?;
    let (channels, rate) = (reader.ident_hdr.audio_channels as u16, reader.ident_hdr.audio_sample_rate);
    let mut samples = Vec::new();
    while let Some(packet) = reader.read_dec_packet_itl().map_err(|error| format!("vorbis: {error}"))? {
        samples.extend(packet.into_iter().map(|value| value as f32 / 32768.0));
    }
    Ok(Clip { channels, rate, samples })
}

fn wav(bytes: &[u8]) -> Result<Clip, String> {
    let mut reader = hound::WavReader::new(Cursor::new(bytes)).map_err(|error| format!("wav: {error}"))?;
    let spec = reader.spec();
    let samples = match (spec.sample_format, spec.bits_per_sample) {
        (hound::SampleFormat::Float, 32) => reader.samples::<f32>().collect::<Result<Vec<_>, _>>(),
        (hound::SampleFormat::Int, bits @ 8..=32) => {
            let scale = 1.0 / (1u64 << (bits - 1)) as f32;
            reader.samples::<i32>().map(|sample| sample.map(|value| value as f32 * scale)).collect::<Result<Vec<_>, _>>()
        }
        (format, bits) => return Err(format!("wav: {format:?} samples of {bits} bits aren't supported")),
    }
    .map_err(|error| format!("wav: {error}"))?;
    Ok(Clip { channels: spec.channels, rate: spec.sample_rate, samples })
}

fn mpeg(bytes: &[u8]) -> Result<Clip, String> {
    let decoded = nanomp3::decode_all::<f32>(bytes);
    let channels = decoded.channels.ok_or("mp3: no audio, or the stream switches between mono and stereo")?;
    Ok(Clip { channels: channels.num() as u16, rate: decoded.sample_rate, samples: decoded.samples })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vorbis_fixture_decodes() {
        let clip = decode(include_bytes!("../../../test/fixtures/tone.ogg")).unwrap();
        assert!(clip.frames() > 0 && clip.rate > 0);
        assert!(clip.samples.iter().any(|sample| sample.abs() > 0.01));
    }

}
