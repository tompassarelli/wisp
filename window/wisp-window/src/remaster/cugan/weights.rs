//! Real-CUGAN's 2x conservative weights, read from the ncnn model file the upstream port ships (`assets/real-cugan/up2x-conservative.bin`, unmodified), and laid out for the kernels: convolution and transposed-convolution weights (both stored `[output][input][tap]` in the file, the transposed ones unflipped) as `[input channel][tap][output channel]` with the output channels padded to a multiple of four, every section a whole number of `vec4`s.

pub const FILE: &[u8] = include_bytes!("../../../assets/real-cugan/up2x-conservative.bin");

/// The MIT notice for these weights, carried in the library so every build that embeds them also ships it.
pub const NOTICE: &str = include_str!("../../../assets/real-cugan/LICENSE.txt");

/// The ncnn tag that precedes a weight blob stored as half floats.
const HALF_TAG: u32 = 0x0130_6B47;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// A valid convolution of `kernel` x `kernel` taps and `stride`.
    Convolution { kernel: u32, stride: u32 },
    /// A transposed convolution with `kernel` taps and a stride of 2.
    Deconvolution { kernel: u32 },
    /// A fully connected layer.
    Dense,
}

/// A layer before its weights are read.
#[derive(Clone, Copy)]
pub struct Spec {
    pub kind: Kind,
    pub inputs: u32,
    pub outputs: u32,
    pub leaky: bool,
}

/// One layer of the network as the model file stores it, in the file's order.
#[derive(Clone, Copy, Debug)]
pub struct Layer {
    pub kind: Kind,
    pub outputs: u32,
    /// Whether a leaky ReLU follows the layer.
    pub leaky: bool,
    /// Offset in `vec4`s of the weights and of the bias in the packed buffer.
    pub weights: u32,
    pub bias: u32,
}

impl Layer {
    /// Output channels rounded up to a whole `vec4`.
    pub fn stride(&self) -> u32 {
        self.outputs.div_ceil(4) * 4
    }
}

pub struct Weights {
    pub layers: Vec<Layer>,
    pub packed: Vec<f32>,
}

const fn conv(inputs: u32, outputs: u32) -> Spec {
    Spec { kind: Kind::Convolution { kernel: 3, stride: 1 }, inputs, outputs, leaky: true }
}

const fn down(inputs: u32, outputs: u32) -> Spec {
    Spec { kind: Kind::Convolution { kernel: 2, stride: 2 }, inputs, outputs, leaky: true }
}

const fn up(inputs: u32, outputs: u32) -> Spec {
    Spec { kind: Kind::Deconvolution { kernel: 2 }, inputs, outputs, leaky: true }
}

const fn dense(inputs: u32, outputs: u32) -> Spec {
    Spec { kind: Kind::Dense, inputs, outputs, leaky: false }
}

const fn linear(spec: Spec) -> Spec {
    Spec { leaky: false, ..spec }
}

/// The layers that carry weights, in the order of the model's `.param` file.
pub const SPEC: [Spec; 30] = [
    conv(3, 32),
    conv(32, 64),
    down(64, 64),
    conv(64, 128),
    conv(128, 64),
    dense(64, 8),
    dense(8, 64),
    up(64, 64),
    conv(64, 64),
    Spec { kind: Kind::Deconvolution { kernel: 4 }, inputs: 64, outputs: 3, leaky: false },
    conv(3, 32),
    conv(32, 64),
    down(64, 64),
    conv(64, 64),
    conv(64, 128),
    dense(128, 16),
    dense(16, 128),
    down(128, 128),
    conv(128, 256),
    conv(256, 128),
    dense(128, 16),
    dense(16, 128),
    up(128, 128),
    conv(128, 64),
    conv(64, 64),
    dense(64, 8),
    dense(8, 64),
    up(64, 64),
    conv(64, 64),
    linear(conv(64, 3)),
];

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn take(&mut self, count: usize) -> Result<&[u8], String> {
        let end = self.at.checked_add(count).filter(|end| *end <= self.bytes.len()).ok_or("the weight file ends early")?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn word(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("four bytes")))
    }

    fn floats(&mut self, count: usize) -> Result<Vec<f32>, String> {
        Ok(self.take(count * 4)?.chunks_exact(4).map(|bytes| f32::from_le_bytes(bytes.try_into().expect("four bytes"))).collect())
    }

    /// A weight blob: a tag word, then raw floats when the tag is zero or half floats (padded to a word) when it is the half tag.
    fn tagged(&mut self, count: usize) -> Result<Vec<f32>, String> {
        match self.word()? {
            0 => self.floats(count),
            HALF_TAG => {
                let halves = self.take((count * 2).div_ceil(4) * 4)?;
                Ok(halves.chunks_exact(2).take(count).map(|bytes| half_to_float(u16::from_le_bytes([bytes[0], bytes[1]]))).collect())
            }
            tag => Err(format!("weight blob tag {tag:#x} is not float or half float")),
        }
    }
}

fn half_to_float(bits: u16) -> f32 {
    let sign = if bits >> 15 == 1 { -1.0 } else { 1.0 };
    let exponent = i32::from((bits >> 10) & 0x1F);
    let fraction = f32::from(bits & 0x3FF);
    match exponent {
        0 => sign * fraction * 2f32.powi(-24),
        31 if fraction == 0.0 => sign * f32::INFINITY,
        31 => f32::NAN,
        _ => sign * (1.0 + fraction / 1024.0) * 2f32.powi(exponent - 15),
    }
}

impl Weights {
    pub fn embedded() -> Result<Self, String> {
        Self::parse(FILE)
    }

    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let mut reader = Reader { bytes, at: 0 };
        let mut packed = Vec::new();
        let mut layers = Vec::new();
        for Spec { kind, inputs, outputs, leaky } in SPEC {
            let taps = match kind {
                Kind::Convolution { kernel, .. } | Kind::Deconvolution { kernel } => kernel * kernel,
                Kind::Dense => 1,
            } as usize;
            let (inputs_n, outputs_n) = (inputs as usize, outputs as usize);
            let weights = reader.tagged(inputs_n * outputs_n * taps)?;
            let bias = reader.floats(outputs_n)?;
            let mut layer = Layer { kind, outputs, leaky, weights: (packed.len() / 4) as u32, bias: 0 };
            let stride = layer.stride() as usize;
            match kind {
                Kind::Convolution { .. } | Kind::Deconvolution { .. } => {
                    for input in 0..inputs_n {
                        for tap in 0..taps {
                            for output in 0..stride {
                                packed.push(if output < outputs_n { weights[(output * inputs_n + input) * taps + tap] } else { 0.0 });
                            }
                        }
                    }
                }
                Kind::Dense => packed.extend_from_slice(&weights),
            }
            layer.bias = (packed.len() / 4) as u32;
            packed.extend(bias.iter().copied().chain(std::iter::repeat(0.0).take(stride - outputs_n)));
            debug_assert!(packed.len() % 4 == 0);
            layers.push(layer);
        }
        if reader.at != bytes.len() {
            return Err(format!("{} bytes of weights follow the last layer", bytes.len() - reader.at));
        }
        Ok(Self { layers, packed })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_file_is_exactly_the_thirty_layers() {
        let weights = Weights::embedded().unwrap();
        assert_eq!(weights.layers.len(), 30);
        assert_eq!(weights.packed.len() % 4, 0);
    }

    #[test]
    fn the_notice_travels_with_the_weights() {
        assert!(NOTICE.starts_with("MIT License") && NOTICE.contains("Copyright (c) 2022 bilibili"));
    }
}

