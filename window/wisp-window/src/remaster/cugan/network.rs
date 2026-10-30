//! Real-CUGAN's CUNet 2x graph on wgpu compute: the layers of `kernels.wgsl` strung in the order of the model's `.param` file. A tile of `w` x `h` pixels (both even) goes in with 18 pixels of context on every side, and `2 (w - 36)` x `2 (h - 36)` pixels of RGB come out.

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use super::weights::{Kind, Layer, Weights};

const KERNELS: &str = include_str!("kernels.wgsl");

/// Pixels of context the network consumes on each side of a tile.
pub const CONTEXT: u32 = 18;

/// The most bytes one activation tensor may take. The widest one, 64 channels at twice the tile plus its context, sets how large a tile may be.
const TENSOR_BUDGET: u64 = 160 << 20;

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
    pad: [u32; 4],
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

    fn dispatch(&self, pass: &mut wgpu::ComputePass<'_>, pipeline: &wgpu::ComputePipeline, params: &Params, buffers: [&wgpu::Buffer; 3], groups: [u32; 3]) {
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
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &group, &[]);
        pass.dispatch_workgroups(groups[0], groups[1], groups[2]);
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

    fn convolution(&mut self, pass: &mut wgpu::ComputePass<'_>, input: &Tensor, layer: usize, residual: Option<Residual<'_>>) -> Tensor {
        let layer = self.layers[layer];
        let Kind::Convolution { kernel, stride } = layer.kind else { unreachable!("layer {layer:?} is not a convolution") };
        let output = self.tensor(layer.outputs, (input.width - kernel) / stride + 1, (input.height - kernel) / stride + 1);
        let params = self.params(&layer, input, &output, &residual);
        let (pipeline, block) = if layer.stride() == 4 { (&self.convolve_narrow, 4) } else { (&self.convolve, 16) };
        let groups = [output.width.div_ceil(8), output.height.div_ceil(8), layer.stride() / block];
        self.dispatch(pass, pipeline, &params, [&input.buffer, residual.as_ref().map_or(&self.unused, |residual| &residual.source.buffer), &output.buffer], groups);
        output
    }

    fn doubling(&mut self, pass: &mut wgpu::ComputePass<'_>, input: &Tensor, layer: usize, residual: Option<Residual<'_>>) -> Tensor {
        let layer = self.layers[layer];
        let output = self.tensor(layer.outputs, input.width * 2, input.height * 2);
        let params = self.params(&layer, input, &output, &residual);
        let groups = [input.width.div_ceil(8), input.height.div_ceil(8), 4 * layer.stride() / 16];
        self.dispatch(pass, &self.expand, &params, [&input.buffer, residual.as_ref().map_or(&self.unused, |residual| &residual.source.buffer), &output.buffer], groups);
        output
    }

    fn doubling_wide(&mut self, pass: &mut wgpu::ComputePass<'_>, input: &Tensor, layer: usize) -> Tensor {
        let layer = self.layers[layer];
        let output = self.tensor(layer.outputs, input.width * 2 - 4, input.height * 2 - 4);
        let params = self.params(&layer, input, &output, &None);
        self.dispatch(pass, &self.expand_wide, &params, [&input.buffer, &self.unused, &output.buffer], [output.width.div_ceil(8), output.height.div_ceil(8), 1]);
        output
    }

    /// Scales each channel of `tensor` in place by the squeeze-excitation gate that `first` and `second` compute from its means.
    fn excite(&mut self, pass: &mut wgpu::ComputePass<'_>, tensor: &Tensor, first: usize, second: usize) {
        let (first, second) = (self.layers[first], self.layers[second]);
        let plane = tensor.plane();
        let mut params = Params { in_c: tensor.channels, in_cs: plane, count: plane, ..Params::default() };
        self.dispatch(pass, &self.mean, &params, [&tensor.buffer, &self.unused, &self.means], [tensor.channels, 1, 1]);
        params = Params { in_c: tensor.channels, out_c: first.outputs, weights: first.weights, bias: first.bias, weights_b: second.weights, bias_b: second.bias, ..Params::default() };
        self.dispatch(pass, &self.gate, &params, [&self.means, &self.unused, &self.gates], [1, 1, 1]);
        let total = tensor.channels * plane;
        let groups = total.div_ceil(256);
        params = Params { in_cs: plane, count: total, ..Params::default() };
        self.dispatch(pass, &self.scale, &params, [&self.gates, &self.unused, &tensor.buffer], [groups.min(65535), groups.div_ceil(65535), 1]);
    }

    /// Runs one tile. `planes` is `3 * width * height` floats in `[0, 1]`, channel after channel; the result is the same layout at twice `(width - 36, height - 36)`.
    pub fn run(&mut self, planes: &[f32], width: u32, height: u32) -> Result<Vec<f32>, String> {
        if width % 2 != 0 || height % 2 != 0 || width <= CONTEXT * 2 + 4 || height <= CONTEXT * 2 + 4 {
            return Err(format!("a {width}x{height} tile is not even or has no pixels inside its context"));
        }
        let input = self.tensor(3, width, height);
        self.queue.write_buffer(&input.buffer, 0, bytemuck::cast_slice(planes));
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("cugan") });
        let output = {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("cugan"), timestamp_writes: None });
            self.record(&mut pass, input)
        };
        let bytes = u64::from(output.channels) * u64::from(output.plane()) * 4;
        let staging = self.device.create_buffer(&wgpu::BufferDescriptor { label: Some("cugan readback"), size: bytes, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false });
        encoder.copy_buffer_to_buffer(&output.buffer, 0, &staging, 0, bytes);
        let submission = self.queue.submit([encoder.finish()]);
        self.release(output);
        let (sender, receiver) = std::sync::mpsc::channel();
        staging.slice(..).map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });
        self.device.poll(wgpu::PollType::Wait { submission_index: Some(submission), timeout: None }).map_err(|error| format!("waiting for the upscaler: {error}"))?;
        receiver.recv().map_err(|error| format!("upscaler readback: {error}"))?.map_err(|error| format!("upscaler readback: {error}"))?;
        let floats = bytemuck::cast_slice(&staging.slice(..).get_mapped_range().map_err(|error| format!("upscaler readback: {error}"))?).to_vec();
        Ok(floats)
    }

    fn record(&mut self, pass: &mut wgpu::ComputePass<'_>, input: Tensor) -> Tensor {
        let a = self.convolution(pass, &input, 0, None);
        self.release(input);
        let skip = self.convolution(pass, &a, 1, None);
        self.release(a);
        let down = self.convolution(pass, &skip, 2, None);
        let b = self.convolution(pass, &down, 3, None);
        self.release(down);
        let c = self.convolution(pass, &b, 4, None);
        self.release(b);
        self.excite(pass, &c, 5, 6);
        let merged = self.doubling(pass, &c, 7, Some(Residual { source: &skip, crop: 4 }));
        self.release(c);
        self.release(skip);
        let d = self.convolution(pass, &merged, 8, None);
        self.release(merged);
        let first = self.doubling_wide(pass, &d, 9);
        self.release(d);

        let e = self.convolution(pass, &first, 10, None);
        let skip_hi = self.convolution(pass, &e, 11, None);
        self.release(e);
        let down = self.convolution(pass, &skip_hi, 12, None);
        let f = self.convolution(pass, &down, 13, None);
        self.release(down);
        let skip_mid = self.convolution(pass, &f, 14, None);
        self.release(f);
        self.excite(pass, &skip_mid, 15, 16);
        let down = self.convolution(pass, &skip_mid, 17, None);
        let g = self.convolution(pass, &down, 18, None);
        self.release(down);
        let h = self.convolution(pass, &g, 19, None);
        self.release(g);
        self.excite(pass, &h, 20, 21);
        let merged = self.doubling(pass, &h, 22, Some(Residual { source: &skip_mid, crop: 4 }));
        self.release(h);
        self.release(skip_mid);
        let i = self.convolution(pass, &merged, 23, None);
        self.release(merged);
        let j = self.convolution(pass, &i, 24, None);
        self.release(i);
        self.excite(pass, &j, 25, 26);
        let merged = self.doubling(pass, &j, 27, Some(Residual { source: &skip_hi, crop: 16 }));
        self.release(j);
        self.release(skip_hi);
        let k = self.convolution(pass, &merged, 28, None);
        self.release(merged);
        let output = self.convolution(pass, &k, 29, Some(Residual { source: &first, crop: 20 }));
        self.release(k);
        self.release(first);
        output
    }
}


#[cfg(test)]
mod tests {
    use super::super::reference;
    use super::*;

    fn device() -> Option<(wgpu::Device, wgpu::Queue)> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default())).ok()?;
        pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).ok()
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
}
