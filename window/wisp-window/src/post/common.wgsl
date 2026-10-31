struct Params {
    right: vec4<f32>,
    up: vec4<f32>,
    forward: vec4<f32>,
    lens: vec4<f32>,
    depth: vec4<f32>,
    rect: vec4<f32>,
    sun_toward: vec4<f32>,
    sun_color: vec4<f32>,
    zenith: vec4<f32>,
    horizon: vec4<f32>,
    ground: vec4<f32>,
    bloom: vec4<f32>,
    occlusion: vec4<f32>,
    misc: vec4<f32>,
    cloud: vec4<f32>,
    eye: vec4<f32>,
};

const CLOUD_SCALE: f32 = 4.0;

@group(0) @binding(0) var<uniform> p: Params;

@vertex
fn vertex_fullscreen(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
    let corner = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    return vec4<f32>(corner * 2.0 - 1.0, 0.0, 1.0);
}

fn picture_ndc(at: vec2<f32>) -> vec2<f32> {
    return vec2<f32>((at.x - p.rect.x) / p.rect.z * 2.0 - 1.0, 1.0 - (at.y - p.rect.y) / p.rect.w * 2.0);
}

fn view_direction(ndc: vec2<f32>) -> vec3<f32> {
    return vec3<f32>(ndc.x * p.lens.x, (ndc.y - p.lens.z) * p.lens.y, -1.0);
}

fn luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn view_depth(d: f32) -> f32 {
    let near = p.depth.x;
    let far = p.depth.y;
    let a = (far + near) / (near - far);
    let b = 2.0 * far * near / (near - far);
    return b / (2.0 * d + a - 1.0);
}

fn view_ray(ndc: vec2<f32>) -> vec3<f32> {
    let direction = view_direction(ndc);
    return normalize(p.right.xyz * direction.x + p.up.xyz * direction.y + p.forward.xyz * -direction.z);
}

const SKY_DEPTH: f32 = 60000.0;

fn half_view_position(pixel: vec2<i32>, w: f32) -> vec3<f32> {
    return view_direction(picture_ndc(vec2<f32>(pixel) * 2.0 + 1.0)) * w;
}
