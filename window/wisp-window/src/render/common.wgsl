struct Frame {
    view_projection: mat4x4<f32>,
    light_toward: vec4<f32>,
    light_key: vec4<f32>,
    light_ambient: vec4<f32>,
    fog_color: vec4<f32>,
    fog_range: vec4<f32>,
    eye: vec4<f32>,
    camera: vec4<f32>,
    screen: vec4<f32>,
    glow: vec4<f32>,
    glow_at: vec4<f32>,
    sun_projection: mat4x4<f32>,
    shadow: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> bones: array<mat4x4<f32>>;

struct Vertex {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) bones: vec4<u32>,
    @location(4) weights: vec4<f32>,
};

struct Instance {
    @location(5) model0: vec4<f32>,
    @location(6) model1: vec4<f32>,
    @location(7) model2: vec4<f32>,
    @location(8) model3: vec4<f32>,
    @location(9) tint: vec4<f32>,
    @location(10) team: vec4<f32>,
    @location(11) base: vec2<u32>,
};

