//! Real-CUGAN's CUNet 2x graph on wgpu compute: the layers of `kernels.wgsl` strung in the order of the model's `.param` file. A tile of `w` x `h` pixels (both even) goes in with 18 pixels of context on every side, and `2 (w - 36)` x `2 (h - 36)` pixels of RGB come out.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use super::weights::{Kind, Layer, Weights};

const KERNELS: &str = include_str!("kernels.wgsl");

/// Pixels of context the network consumes on each side of a tile.
pub const CONTEXT: u32 = 18;

/// The most bytes one activation tensor may take. The widest one, 64 channels at twice the tile plus its context, sets how large a tile may be.
const TENSOR_BUDGET: u64 = 160 << 20;

/// Multiply-adds one submission may hold, so the window's frames, which share the GPU's queue, wait behind a few milliseconds of the network and not a whole texture of it: about 3 ms on a Radeon 890M, which runs the network at some 90 million a millisecond.
const SLICE_MACS: u64 = 1 << 28;

/// Rest between two polls while the GPU runs a slice.
const POLL: std::time::Duration = std::time::Duration::from_micros(250);

/// The limits a device needs for the upscaler: the default ones with one storage binding raised to the budget where the adapter allows it, so a 512 x 256 texture runs as one tile.
pub fn device_limits(adapter: &wgpu::Limits) -> wgpu::Limits {
    let defaults = wgpu::Limits::default();
    wgpu::Limits { max_storage_buffer_binding_size: adapter.max_storage_buffer_binding_size.min(TENSOR_BUDGET).max(defaults.max_storage_buffer_binding_size), ..defaults }
}

/// Floats in the widest activation of a tile of `width` x `height` pixels without its context.
pub fn widest_activation(width: usize, height: usize) -> u64 {
    let context = 2 * CONTEXT as usize;
    (64 * (2 * (width + width % 2 + context) - context) * (2 * (height + height % 2 + context) - context)) as u64
}

#[repr(C)]
#[derive(Clone, Copy, Default, Pod, Zeroable)]
struct Params {
    in_c: u32,
    in_w: u32,
    in_h: u32,
    in_cs: u32,
    out_c: u32,
    out_w: u32,
    out_h: u32,
    out_cs: u32,
    stride: u32,
    kernel: u32,
    step: u32,
    flags: u32,
    weights: u32,
    bias: u32,
    res_w: u32,
    res_cs: u32,
    res_off: u32,
    count: u32,
    weights_b: u32,
    bias_b: u32,
    row0: u32,
    pad: [u32; 3],
}

const LEAKY: u32 = 1;
const RESIDUAL: u32 = 2;

/// A planar f32 tensor in a pooled buffer.
struct Tensor {
    buffer: wgpu::Buffer,
    channels: u32,
    width: u32,
    height: u32,
}

impl Tensor {
    fn plane(&self) -> u32 {
        self.width * self.height
    }
}

/// Added to a layer's output after its activation: `source` cropped by `crop` pixels on every side.
struct Residual<'a> {
    source: &'a Tensor,
    crop: u32,
}

pub struct Network {
    device: wgpu::Device,
    queue: wgpu::Queue,
    layout: wgpu::BindGroupLayout,
    weights: wgpu::Buffer,
    layers: Vec<Layer>,
    convolve: wgpu::ComputePipeline,
    convolve_narrow: wgpu::ComputePipeline,
    expand: wgpu::ComputePipeline,
    expand_wide: wgpu::ComputePipeline,
    mean: wgpu::ComputePipeline,
    gate: wgpu::ComputePipeline,
    scale: wgpu::ComputePipeline,
    means: wgpu::Buffer,
    gates: wgpu::Buffer,
    unused: wgpu::Buffer,
    free: Vec<wgpu::Buffer>,
}

fn storage(device: &wgpu::Device, label: &str, bytes: u64) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor { label: Some(label), size: bytes, usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::COPY_SRC, mapped_at_creation: false })
}

impl Network {
    pub fn new(device: wgpu::Device, queue: wgpu::Queue) -> Result<Self, String> {
        let weights = Weights::embedded()?;
        let packed = device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("cugan weights"), contents: bytemuck::cast_slice(&weights.packed), usage: wgpu::BufferUsages::STORAGE });
        let entry = |binding, ty| wgpu::BindGroupLayoutEntry { binding, visibility: wgpu::ShaderStages::COMPUTE, ty, count: None };
        let read_only = |binding| entry(binding, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("cugan"),
            entries: &[
                entry(0, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }),
                read_only(1),
                read_only(2),
                read_only(3),
                entry(4, wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: false }, has_dynamic_offset: false, min_binding_size: None }),
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("cugan"), bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
        let module = |vectors: u32| device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("cugan kernels"), source: wgpu::ShaderSource::Wgsl(format!("const OCV: u32 = {vectors}u;\n{KERNELS}").into()) });
        let (wide, narrow) = (module(4), module(1));
        let pipeline = |module: &wgpu::ShaderModule, entry_point: &str| {
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor { label: Some(entry_point), layout: Some(&pipeline_layout), module, entry_point: Some(entry_point), compilation_options: Default::default(), cache: None })
        };
        Ok(Self {
            layout,
            weights: packed,
            layers: weights.layers,
            convolve: pipeline(&wide, "convolve"),
            convolve_narrow: pipeline(&narrow, "convolve"),
            expand: pipeline(&wide, "expand"),
            expand_wide: pipeline(&narrow, "expand_wide"),
            mean: pipeline(&narrow, "mean"),
            gate: pipeline(&narrow, "gate"),
            scale: pipeline(&narrow, "scale"),
            means: storage(&device, "means", 512),
            gates: storage(&device, "gates", 512),
            unused: storage(&device, "unused", 16),
            free: Vec::new(),
            device,
            queue,
        })
    }

    /// How many floats the widest activation of a tile may hold: one storage binding, and no more than `TENSOR_BUDGET` bytes.
    pub fn tensor_floats(&self) -> u64 {
        self.device.limits().max_storage_buffer_binding_size.min(TENSOR_BUDGET) / 4
    }

    fn take(&mut self, floats: u64) -> wgpu::Buffer {
        let bytes = floats * 4;
        let best = self.free.iter().enumerate().filter(|(_, buffer)| buffer.size() >= bytes).min_by_key(|(_, buffer)| buffer.size()).map(|(index, _)| index);
        match best {
            Some(index) => self.free.swap_remove(index),
            None => storage(&self.device, "cugan tensor", bytes.max(16)),
        }
    }

    fn tensor(&mut self, channels: u32, width: u32, height: u32) -> Tensor {
        let buffer = self.take(u64::from(channels) * u64::from(width) * u64::from(height));
        Tensor { buffer, channels, width, height }
    }

    fn release(&mut self, tensor: Tensor) {
        self.free.push(tensor.buffer);
    }

    /// Records one dispatch of `macs` multiply-adds, submitting the work held so far first when this one would take it past the budget.
    fn dispatch(&self, slices: &mut Slices, pipeline: &wgpu::ComputePipeline, params: &Params, buffers: [&wgpu::Buffer; 3], groups: [u32; 3], macs: u64) -> Result<(), String> {
        slices.make_room(macs, &self.device, &self.queue)?;
        let uniform = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some("cugan params"), contents: bytemuck::bytes_of(params), usage: wgpu::BufferUsages::UNIFORM });
        let [source, residual, destination] = buffers;
        let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("cugan"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: source.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: self.weights.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 3, resource: residual.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 4, resource: destination.as_entire_binding() },
            ],
        });
        let mut pass = slices.encoder.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("cugan"), timestamp_writes: None });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &group, &[]);
        pass.dispatch_workgroups(groups[0], groups[1], groups[2]);
        slices.held += macs;
        Ok(())
    }

    /// Records a dispatch whose workgroup rows are rows of 8 pixels, in bands of rows that each fit the budget.
    fn dispatch_rows(&self, slices: &mut Slices, pipeline: &wgpu::ComputePipeline, params: &Params, buffers: [&wgpu::Buffer; 3], groups: [u32; 3], macs: u64) -> Result<(), String> {
        let per_row = macs.div_ceil(u64::from(groups[1]).max(1));
        for (first, rows) in bands(groups[1], per_row, slices.budget) {
            self.dispatch(slices, pipeline, &Params { row0: first * 8, ..*params }, buffers, [groups[0], rows, groups[2]], per_row * u64::from(rows))?;
        }
        Ok(())
    }

    fn params(&self, layer: &Layer, input: &Tensor, output: &Tensor, residual: &Option<Residual<'_>>) -> Params {
        let (kernel, stride) = match layer.kind {
            Kind::Convolution { kernel, stride } => (kernel, stride),
            Kind::Deconvolution { kernel } => (kernel, 2),
            Kind::Dense => (1, 1),
        };
        let mut flags = if layer.leaky { LEAKY } else { 0 };
        let (res_w, res_cs, res_off) = residual.as_ref().map_or((0, 0, 0), |residual| {
            flags |= RESIDUAL;
            (residual.source.width, residual.source.plane(), residual.crop)
        });
        Params {
            in_c: input.channels,
            in_w: input.width,
            in_h: input.height,
            in_cs: input.plane(),
            out_c: output.channels,
            out_w: output.width,
            out_h: output.height,
            out_cs: output.plane(),
            stride,
            kernel,
            step: layer.stride(),
            flags,
            weights: layer.weights,
            bias: layer.bias,
            res_w,
            res_cs,
            res_off,
            ..Params::default()
        }
    }

    fn convolution(&mut self, slices: &mut Slices, input: &Tensor, layer: usize, residual: Option<Residual<'_>>) -> Result<Tensor, String> {
        let layer = self.layers[layer];
        let Kind::Convolution { kernel, stride } = layer.kind else { unreachable!("layer {layer:?} is not a convolution") };
        let output = self.tensor(layer.outputs, (input.width - kernel) / stride + 1, (input.height - kernel) / stride + 1);
        let params = self.params(&layer, input, &output, &residual);
        let (pipeline, block) = if layer.stride() == 4 { (&self.convolve_narrow, 4) } else { (&self.convolve, 16) };
        let groups = [output.width.div_ceil(8), output.height.div_ceil(8), layer.stride() / block];
        let macs = u64::from(output.plane()) * u64::from(output.channels) * u64::from(input.channels) * u64::from(kernel * kernel);
        self.dispatch_rows(slices, pipeline, &params, [&input.buffer, residual.as_ref().map_or(&self.unused, |residual| &residual.source.buffer), &output.buffer], groups, macs)?;
        Ok(output)
    }

    fn doubling(&mut self, slices: &mut Slices, input: &Tensor, layer: usize, residual: Option<Residual<'_>>) -> Result<Tensor, String> {
        let layer = self.layers[layer];
        let output = self.tensor(layer.outputs, input.width * 2, input.height * 2);
        let params = self.params(&layer, input, &output, &residual);
        let groups = [input.width.div_ceil(8), input.height.div_ceil(8), 4 * layer.stride() / 16];
        let macs = u64::from(output.plane()) * u64::from(output.channels) * u64::from(input.channels);
        self.dispatch_rows(slices, &self.expand, &params, [&input.buffer, residual.as_ref().map_or(&self.unused, |residual| &residual.source.buffer), &output.buffer], groups, macs)?;
        Ok(output)
    }

    fn doubling_wide(&mut self, slices: &mut Slices, input: &Tensor, layer: usize) -> Result<Tensor, String> {
        let layer = self.layers[layer];
        let output = self.tensor(layer.outputs, input.width * 2 - 4, input.height * 2 - 4);
        let params = self.params(&layer, input, &output, &None);
        let macs = u64::from(output.plane()) * u64::from(output.channels) * u64::from(input.channels) * 4;
        self.dispatch_rows(slices, &self.expand_wide, &params, [&input.buffer, &self.unused, &output.buffer], [output.width.div_ceil(8), output.height.div_ceil(8), 1], macs)?;
        Ok(output)
    }

    /// Scales each channel of `tensor` in place by the squeeze-excitation gate that `first` and `second` compute from its means.
    fn excite(&mut self, slices: &mut Slices, tensor: &Tensor, first: usize, second: usize) -> Result<(), String> {
        let (first, second) = (self.layers[first], self.layers[second]);
        let plane = tensor.plane();
        let total = tensor.channels * plane;
        let mut params = Params { in_c: tensor.channels, in_cs: plane, count: plane, ..Params::default() };
        self.dispatch(slices, &self.mean, &params, [&tensor.buffer, &self.unused, &self.means], [tensor.channels, 1, 1], u64::from(total))?;
        params = Params { in_c: tensor.channels, out_c: first.outputs, weights: first.weights, bias: first.bias, weights_b: second.weights, bias_b: second.bias, ..Params::default() };
        self.dispatch(slices, &self.gate, &params, [&self.means, &self.unused, &self.gates], [1, 1, 1], u64::from(tensor.channels * first.outputs * 2))?;
        let groups = total.div_ceil(256);
        params = Params { in_cs: plane, count: total, ..Params::default() };
        self.dispatch(slices, &self.scale, &params, [&self.gates, &self.unused, &tensor.buffer], [groups.min(65535), groups.div_ceil(65535), 1], u64::from(total))
    }

    /// Runs one tile. `planes` is `3 * width * height` floats in `[0, 1]`, channel after channel; the result is the same layout at twice `(width - 36, height - 36)`.
    pub fn run(&mut self, planes: &[f32], width: u32, height: u32) -> Result<Vec<f32>, String> {
        self.run_sliced(planes, width, height, SLICE_MACS).map(|(floats, _)| floats)
    }

    /// `run` in submissions of at most `budget` multiply-adds each, with no more than one waiting behind the one the GPU is running; also returns the multiply-adds of each submission.
    fn run_sliced(&mut self, planes: &[f32], width: u32, height: u32, budget: u64) -> Result<(Vec<f32>, Vec<u64>), String> {
        if width % 2 != 0 || height % 2 != 0 || width <= CONTEXT * 2 + 4 || height <= CONTEXT * 2 + 4 {
            return Err(format!("a {width}x{height} tile is not even or has no pixels inside its context"));
        }
        let input = self.tensor(3, width, height);
        self.queue.write_buffer(&input.buffer, 0, bytemuck::cast_slice(planes));
        let mut slices = Slices::new(&self.device, budget);
        let output = self.record(&mut slices, input)?;
        let bytes = u64::from(output.channels) * u64::from(output.plane()) * 4;
        let staging = self.device.create_buffer(&wgpu::BufferDescriptor { label: Some("cugan readback"), size: bytes, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
        slices.encoder.copy_buffer_to_buffer(&output.buffer, 0, &staging, 0, bytes);
        slices.flush(&self.device, &self.queue)?;
        self.release(output);
        let (sender, receiver) = std::sync::mpsc::channel();
        staging.slice(..).map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });
        let mut mapped = None;
        until(&self.device, || {
            mapped = mapped.take().or_else(|| receiver.try_recv().ok());
            mapped.is_some()
        })?;
        mapped.expect("the readback was mapped").map_err(|error| format!("upscaler readback: {error}"))?;
        let floats = bytemuck::cast_slice(&staging.slice(..).get_mapped_range().map_err(|error| format!("upscaler readback: {error}"))?).to_vec();
        Ok((floats, slices.submitted))
    }

    fn record(&mut self, slices: &mut Slices, input: Tensor) -> Result<Tensor, String> {
        let a = self.convolution(slices, &input, 0, None)?;
        self.release(input);
        let skip = self.convolution(slices, &a, 1, None)?;
        self.release(a);
        let down = self.convolution(slices, &skip, 2, None)?;
        let b = self.convolution(slices, &down, 3, None)?;
        self.release(down);
        let c = self.convolution(slices, &b, 4, None)?;
        self.release(b);
        self.excite(slices, &c, 5, 6)?;
        let merged = self.doubling(slices, &c, 7, Some(Residual { source: &skip, crop: 4 }))?;
        self.release(c);
        self.release(skip);
        let d = self.convolution(slices, &merged, 8, None)?;
        self.release(merged);
        let first = self.doubling_wide(slices, &d, 9)?;
        self.release(d);

        let e = self.convolution(slices, &first, 10, None)?;
        let skip_hi = self.convolution(slices, &e, 11, None)?;
        self.release(e);
        let down = self.convolution(slices, &skip_hi, 12, None)?;
        let f = self.convolution(slices, &down, 13, None)?;
        self.release(down);
        let skip_mid = self.convolution(slices, &f, 14, None)?;
        self.release(f);
        self.excite(slices, &skip_mid, 15, 16)?;
        let down = self.convolution(slices, &skip_mid, 17, None)?;
        let g = self.convolution(slices, &down, 18, None)?;
        self.release(down);
        let h = self.convolution(slices, &g, 19, None)?;
        self.release(g);
        self.excite(slices, &h, 20, 21)?;
        let merged = self.doubling(slices, &h, 22, Some(Residual { source: &skip_mid, crop: 4 }))?;
        self.release(h);
        self.release(skip_mid);
        let i = self.convolution(slices, &merged, 23, None)?;
        self.release(merged);
        let j = self.convolution(slices, &i, 24, None)?;
        self.release(i);
        self.excite(slices, &j, 25, 26)?;
        let merged = self.doubling(slices, &j, 27, Some(Residual { source: &skip_hi, crop: 16 }))?;
        self.release(j);
        self.release(skip_hi);
        let k = self.convolution(slices, &merged, 28, None)?;
        self.release(merged);
        let output = self.convolution(slices, &k, 29, Some(Residual { source: &first, crop: 20 }))?;
        self.release(k);
        self.release(first);
        Ok(output)
    }
}

/// The network's work on its way to the queue it shares with the window's frames: dispatches collect in one encoder until the next would take it past `budget` multiply-adds, and the encoder is then submitted; at most one submission waits behind the one the GPU is running, so the GPU never idles between slices and a frame queues behind two at the most.
struct Slices {
    budget: u64,
    encoder: wgpu::CommandEncoder,
    held: u64,
    submitted: Vec<u64>,
    ahead: Option<Arc<AtomicBool>>,
}

impl Slices {
    fn new(device: &wgpu::Device, budget: u64) -> Self {
        Self { budget, encoder: encoder(device), held: 0, submitted: Vec::new(), ahead: None }
    }

    fn make_room(&mut self, macs: u64, device: &wgpu::Device, queue: &wgpu::Queue) -> Result<(), String> {
        if self.held > 0 && self.held + macs > self.budget {
            self.flush(device, queue)?;
        }
        Ok(())
    }

    fn flush(&mut self, device: &wgpu::Device, queue: &wgpu::Queue) -> Result<(), String> {
        queue.submit([std::mem::replace(&mut self.encoder, encoder(device)).finish()]);
        self.submitted.push(std::mem::take(&mut self.held));
        let done = Arc::new(AtomicBool::new(false));
        let signal = done.clone();
        queue.on_submitted_work_done(move || signal.store(true, Ordering::Release));
        match self.ahead.replace(done) {
            Some(ahead) => until(device, || ahead.load(Ordering::Acquire)),
            None => Ok(()),
        }
    }
}

/// Polls `device` without blocking until `finished`: a blocking poll holds the device lock the window's present needs for as long as the GPU takes, so every frame would wait out the network.
fn until(device: &wgpu::Device, mut finished: impl FnMut() -> bool) -> Result<(), String> {
    while !finished() {
        device.poll(wgpu::PollType::Poll).map_err(|error| format!("waiting for the upscaler: {error}"))?;
        if !finished() {
            std::thread::sleep(POLL);
        }
    }
    Ok(())
}

fn encoder(device: &wgpu::Device) -> wgpu::CommandEncoder {
    device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("cugan") })
}

/// Bands `(first, count)` of `rows` rows, each of at most `budget` multiply-adds when a row costs `per_row`; a row that alone exceeds the budget is a band by itself.
fn bands(rows: u32, per_row: u64, budget: u64) -> impl Iterator<Item = (u32, u32)> {
    let size = (budget / per_row.max(1)).clamp(1, u64::from(rows.max(1))) as u32;
    (0..rows).step_by(size as usize).map(move |first| (first, size.min(rows - first)))
}


#[cfg(test)]
mod tests {
    use super::super::reference;
    use super::*;

    fn device() -> Option<(wgpu::Device, wgpu::Queue)> {
        crate::test_gpu::device()
    }

    fn picture(width: usize, height: usize) -> Vec<f32> {
        (0..3 * width * height).map(|index| ((index * 37 % 101) as f32 / 100.0 + (index % width) as f32 / width as f32) / 2.0).collect()
    }

    #[test]
    fn the_kernels_match_a_plain_cpu_pass_of_the_same_graph() {
        let Some((device, queue)) = device() else { return };
        let mut network = Network::new(device, queue).unwrap();
        let (width, height) = (50, 46);
        let expected = reference::forward(picture(width, height), width, height);
        let got = network.run(&picture(width, height), width as u32, height as u32).unwrap();
        assert_eq!(got.len(), expected.data().len());
        let worst = got.iter().zip(expected.data()).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max);
        assert!(worst < 1e-3, "the GPU differs from the CPU pass by {worst}");
    }

    #[test]
    fn a_tile_split_into_small_submissions_gives_the_same_pixels() {
        let Some((device, queue)) = device() else { return };
        let mut network = Network::new(device, queue).unwrap();
        let (width, height) = (50, 46);
        let (whole, one) = network.run_sliced(&picture(width, height), width as u32, height as u32, u64::MAX).unwrap();
        let budget = 1 << 25;
        let (sliced, submitted) = network.run_sliced(&picture(width, height), width as u32, height as u32, budget).unwrap();
        assert_eq!(one.len(), 1);
        assert!(submitted.len() > 10 && submitted.iter().all(|&macs| macs <= budget), "{submitted:?}");
        assert_eq!(submitted.iter().sum::<u64>(), one[0]);
        assert_eq!(sliced, whole);
    }

    #[test]
    fn rows_are_banded_within_the_budget_and_a_costly_row_stands_alone() {
        assert_eq!(bands(10, 3, 9).collect::<Vec<_>>(), [(0, 3), (3, 3), (6, 3), (9, 1)]);
        assert_eq!(bands(4, 10, 9).collect::<Vec<_>>(), [(0, 1), (1, 1), (2, 1), (3, 1)]);
        assert_eq!(bands(4, 1, u64::MAX).collect::<Vec<_>>(), [(0, 4)]);
    }
}
