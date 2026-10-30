//! A plain CPU forward pass of the same graph, so the kernels are checked against it without a texture or the reference tool.

use super::weights::{Kind, Layer, Weights};

#[derive(Clone)]
pub struct Tensor {
    channels: usize,
    width: usize,
    height: usize,
    data: Vec<f32>,
}

impl Tensor {
    pub fn new(channels: usize, width: usize, height: usize, data: Vec<f32>) -> Self {
        assert_eq!(data.len(), channels * width * height);
        Self { channels, width, height, data }
    }

    pub fn data(&self) -> &[f32] {
        &self.data
    }

    fn plane(&self) -> usize {
        self.width * self.height
    }

    fn crop(&self, by: usize) -> Tensor {
        let (width, height) = (self.width - 2 * by, self.height - 2 * by);
        let mut data = Vec::with_capacity(self.channels * width * height);
        for channel in 0..self.channels {
            for y in 0..height {
                let row = channel * self.plane() + (y + by) * self.width + by;
                data.extend_from_slice(&self.data[row..row + width]);
            }
        }
        Tensor::new(self.channels, width, height, data)
    }

    fn add(&mut self, other: &Tensor) {
        for (a, b) in self.data.iter_mut().zip(&other.data) {
            *a += b;
        }
    }
}

struct Model {
    weights: Weights,
}

impl Model {
    fn weight(&self, layer: &Layer, index: usize) -> f32 {
        self.weights.packed[layer.weights as usize * 4 + index]
    }

    fn bias(&self, layer: &Layer, channel: usize) -> f32 {
        self.weights.packed[layer.bias as usize * 4 + channel]
    }

    fn activate(layer: &Layer, value: f32) -> f32 {
        if layer.leaky && value < 0.0 {
            value * 0.1
        } else {
            value
        }
    }

    fn convolve(&self, index: usize, input: &Tensor) -> Tensor {
        let layer = self.weights.layers[index];
        let Kind::Convolution { kernel, stride } = layer.kind else { panic!("layer {index} is not a convolution") };
        let (kernel, stride, step) = (kernel as usize, stride as usize, layer.stride() as usize);
        let (width, height) = ((input.width - kernel) / stride + 1, (input.height - kernel) / stride + 1);
        let mut data = vec![0.0; layer.outputs as usize * width * height];
        for channel in 0..layer.outputs as usize {
            for y in 0..height {
                for x in 0..width {
                    let mut sum = self.bias(&layer, channel);
                    for source in 0..input.channels {
                        for ky in 0..kernel {
                            for kx in 0..kernel {
                                sum += input.data[source * input.plane() + (y * stride + ky) * input.width + x * stride + kx] * self.weight(&layer, (source * kernel * kernel + ky * kernel + kx) * step + channel);
                            }
                        }
                    }
                    data[channel * width * height + y * width + x] = Self::activate(&layer, sum);
                }
            }
        }
        Tensor::new(layer.outputs as usize, width, height, data)
    }

    fn expand(&self, index: usize, input: &Tensor) -> Tensor {
        let layer = self.weights.layers[index];
        let Kind::Deconvolution { kernel } = layer.kind else { panic!("layer {index} is not a transposed convolution") };
        let (kernel, step, outputs) = (kernel as usize, layer.stride() as usize, layer.outputs as usize);
        let (full_width, full_height) = ((input.width - 1) * 2 + kernel, (input.height - 1) * 2 + kernel);
        let mut full = vec![0.0f32; outputs * full_width * full_height];
        for source in 0..input.channels {
            for y in 0..input.height {
                for x in 0..input.width {
                    let value = input.data[source * input.plane() + y * input.width + x];
                    for ky in 0..kernel {
                        for kx in 0..kernel {
                            for channel in 0..outputs {
                                full[channel * full_width * full_height + (y * 2 + ky) * full_width + x * 2 + kx] += value * self.weight(&layer, (source * kernel * kernel + ky * kernel + kx) * step + channel);
                            }
                        }
                    }
                }
            }
        }
        let trim = if kernel == 4 { 3 } else { 0 };
        let (width, height) = (full_width - 2 * trim, full_height - 2 * trim);
        let mut data = vec![0.0; outputs * width * height];
        for channel in 0..outputs {
            for y in 0..height {
                for x in 0..width {
                    data[channel * width * height + y * width + x] = Self::activate(&layer, full[channel * full_width * full_height + (y + trim) * full_width + x + trim] + self.bias(&layer, channel));
                }
            }
        }
        Tensor::new(outputs, width, height, data)
    }

    fn excite(&self, first: usize, second: usize, tensor: &mut Tensor) {
        let (first, second) = (self.weights.layers[first], self.weights.layers[second]);
        let plane = tensor.plane();
        let means: Vec<f32> = (0..tensor.channels).map(|channel| tensor.data[channel * plane..(channel + 1) * plane].iter().sum::<f32>() / plane as f32).collect();
        let hidden: Vec<f32> = (0..first.outputs as usize).map(|row| (self.bias(&first, row) + (0..tensor.channels).map(|column| self.weight(&first, row * tensor.channels + column) * means[column]).sum::<f32>()).max(0.0)).collect();
        for channel in 0..tensor.channels {
            let sum = self.bias(&second, channel) + hidden.iter().enumerate().map(|(row, value)| self.weight(&second, channel * hidden.len() + row) * value).sum::<f32>();
            let gate = 1.0 / (1.0 + (-sum).exp());
            for value in &mut tensor.data[channel * plane..(channel + 1) * plane] {
                *value *= gate;
            }
        }
    }

    fn run(&self, input: &Tensor) -> Tensor {
        let a = self.convolve(0, input);
        let skip = self.convolve(1, &a);
        let b = self.convolve(3, &self.convolve(2, &skip));
        let mut c = self.convolve(4, &b);
        self.excite(5, 6, &mut c);
        let mut merged = self.expand(7, &c);
        merged.add(&skip.crop(4));
        let first = self.expand(9, &self.convolve(8, &merged));

        let skip_high = self.convolve(11, &self.convolve(10, &first));
        let mut skip_mid = self.convolve(14, &self.convolve(13, &self.convolve(12, &skip_high)));
        self.excite(15, 16, &mut skip_mid);
        let mut h = self.convolve(19, &self.convolve(18, &self.convolve(17, &skip_mid)));
        self.excite(20, 21, &mut h);
        let mut merged = self.expand(22, &h);
        merged.add(&skip_mid.crop(4));
        let mut j = self.convolve(24, &self.convolve(23, &merged));
        self.excite(25, 26, &mut j);
        let mut merged = self.expand(27, &j);
        merged.add(&skip_high.crop(16));
        let mut output = self.convolve(29, &self.convolve(28, &merged));
        output.add(&first.crop(20));
        output
    }
}

pub fn forward(planes: Vec<f32>, width: usize, height: usize) -> Tensor {
    Model { weights: Weights::embedded().expect("embedded weights") }.run(&Tensor::new(3, width, height, planes))
}
