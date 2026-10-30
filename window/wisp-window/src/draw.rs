use std::sync::Arc;
use winit::window::Window;

const COUNTER_BITS: usize = 24;
const VERTICES: usize = COUNTER_BITS * 6;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Vertex {
    position: [f32; 2],
    color: [f32; 3],
}

const SHADER: &str = "
struct In { @location(0) position: vec2<f32>, @location(1) color: vec3<f32> };
struct Out { @builtin(position) position: vec4<f32>, @location(0) color: vec3<f32> };
@vertex fn vs(input: In) -> Out { var out: Out; out.position = vec4<f32>(input.position, 0.0, 1.0); out.color = input.color; return out; }
@fragment fn fs(input: Out) -> @location(0) vec4<f32> { return vec4<f32>(input.color, 1.0); }
";

/// The clear colour for a step: a slow drift so a frozen window is visible, never reaching the counter's colours.
fn clear_color(step: u64) -> [f64; 3] {
    let phase = (step % 600) as f64 / 600.0;
    [0.06 + 0.04 * phase, 0.08 + 0.05 * (1.0 - phase), 0.14]
}

/// The step counter as 24 squares, least significant bit at the left, lit when the bit is set.
fn counter_vertices(step: u64) -> Vec<Vertex> {
    let size = 0.05_f32;
    let gap = 0.015_f32;
    let left = -(COUNTER_BITS as f32 * (size + gap)) / 2.0;
    let mut vertices = Vec::with_capacity(VERTICES);
    for bit in 0..COUNTER_BITS {
        let color = if step >> bit & 1 == 1 { [0.95, 0.85, 0.2] } else { [0.16, 0.18, 0.26] };
        let x = left + bit as f32 * (size + gap);
        let (y, top) = (-0.9_f32, -0.9_f32 + size * 1.6);
        for (cx, cy) in [(x, y), (x + size, y), (x, top), (x, top), (x + size, y), (x + size, top)] {
            vertices.push(Vertex { position: [cx, cy], color });
        }
    }
    vertices
}

pub struct Gpu {
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    vertices: wgpu::Buffer,
    pub adapter: String,
    pub backend: String,
}

impl Gpu {
    pub fn new(window: Arc<Window>) -> Result<Self, String> {
        let size = window.inner_size();
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let surface = instance.create_surface(window).map_err(|e| format!("surface: {e}"))?;
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
            apply_limit_buckets: false,
        }))
        .map_err(|e| format!("adapter: {e}"))?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).map_err(|e| format!("device: {e}"))?;
        let mut config = surface.get_default_config(&adapter, size.width.max(1), size.height.max(1)).ok_or("surface not supported by the adapter")?;
        config.present_mode = wgpu::PresentMode::Fifo;
        config.desired_maximum_frame_latency = 1;
        surface.configure(&device, &config);
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(SHADER.into()) });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[], immediate_size: 0 });
        let attributes = wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x3];
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None,
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout { array_stride: std::mem::size_of::<Vertex>() as u64, step_mode: wgpu::VertexStepMode::Vertex, attributes: &attributes })],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(config.format.into())],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let vertices = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (VERTICES * std::mem::size_of::<Vertex>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let info = adapter.get_info();
        Ok(Self { surface, config, device, queue, pipeline, vertices, adapter: info.name, backend: format!("{:?}", info.backend) })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 || (width == self.config.width && height == self.config.height) {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);
    }

    /// Blocks until the display hands back an image under `Fifo`; `None` when the window shows nothing right now.
    pub fn acquire(&mut self) -> Option<wgpu::SurfaceTexture> {
        match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture) => Some(texture),
            wgpu::CurrentSurfaceTexture::Suboptimal(texture) => {
                drop(texture);
                self.surface.configure(&self.device, &self.config);
                None
            }
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.device, &self.config);
                None
            }
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded | wgpu::CurrentSurfaceTexture::Validation => None,
        }
    }

    pub fn present(&self, texture: wgpu::SurfaceTexture) {
        self.queue.present(texture);
    }

    pub fn draw(&self, texture: &wgpu::SurfaceTexture, step: u64) {
        let view = texture.texture.create_view(&Default::default());
        self.queue.write_buffer(&self.vertices, 0, bytemuck::cast_slice(&counter_vertices(step)));
        let [r, g, b] = clear_color(step);
        let mut encoder = self.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color { r, g, b, a: 1.0 }), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_vertex_buffer(0, self.vertices.slice(..));
            pass.draw(0..VERTICES as u32, 0..1);
        }
        self.queue.submit([encoder.finish()]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counter_lights_the_set_bits() {
        let lit = |step: u64| counter_vertices(step).chunks(6).filter(|square| square[0].color[0] > 0.5).count();
        assert_eq!(lit(0), 0);
        assert_eq!(lit(0b1011), 3);
        assert_eq!(counter_vertices(7).len(), VERTICES);
    }
}
