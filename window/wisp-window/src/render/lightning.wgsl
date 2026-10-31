struct Frame {
    view_projection: mat4x4<f32>,
    light_toward: vec4<f32>,
    light_key: vec4<f32>,
    light_ambient: vec4<f32>,
    fog_color: vec4<f32>,
    fog_range: vec4<f32>,
    right: vec4<f32>,
    up: vec4<f32>,
    eye: vec4<f32>,
};

struct Bolt {
    origin: vec4<f32>,
    to: vec4<f32>,
    color: vec4<f32>,
    shape: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<storage, read> bolts: array<Bolt>;
@group(1) @binding(1) var bolt_texture: texture_2d<f32>;
@group(1) @binding(2) var bolt_sampler: sampler;

struct Varying {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) across: f32,
    @location(2) uv: vec2<f32>,
    @location(3) @interpolate(flat) textured: u32,
};

const PLAIN_SEGMENTS: u32 = 24u;
const TEXTURED: u32 = 2u;
const SCROLL: f32 = 1.5;

fn hash(value: u32) -> f32 {
    var x = value * 747796405u + 2891336453u;
    x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
    x = (x >> 22u) ^ x;
    return f32(x & 0xffffffu) / 8388608.0 - 1.0;
}

@vertex
fn vertex_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Varying {
    let bolt = bolts[instance];
    let kind = u32(bolt.to.w);
    let textured = kind == TEXTURED;
    let core = kind == 1u;
    let segments = select(PLAIN_SEGMENTS, u32(bolt.shape.y), textured);
    let step = min(vertex / 2u, segments);
    let side = select(-1.0, 1.0, vertex % 2u == 0u);
    let along = f32(step) / f32(segments);
    let direction = bolt.to.xyz - bolt.origin.xyz;
    let reach = length(direction);
    let straight = mix(bolt.origin.xyz, bolt.to.xyz, along);
    let tick = u32(frame.eye.w * 24.0);
    let seed = u32(bolt.origin.w) * 7919u + tick * 104729u + step * 31u;
    var wide = cross(direction, frame.eye.xyz - straight);
    if (dot(wide, wide) < 1e-6) {
        wide = frame.right.xyz;
    }
    wide = normalize(wide);
    let tall = normalize(cross(wide, direction + vec3<f32>(1e-4)));
    let envelope = sin(along * 3.14159265);
    let amplitude = select(min(reach * 0.06, 60.0), bolt.shape.z, textured) * envelope;
    let point = straight + wide * hash(seed) * amplitude + tall * hash(seed + 977u) * amplitude;
    let distance_to_eye = length(frame.eye.xyz - point);
    let plain_width = max(distance_to_eye * select(0.0075, 0.0022, core), 1.0);
    let half_width = select(plain_width, max(bolt.shape.x, distance_to_eye * 0.002), textured);
    var out: Varying;
    out.clip = frame.view_projection * vec4<f32>(point + wide * side * half_width, 1.0);
    out.across = side;
    out.uv = vec2<f32>(along * reach * bolt.shape.w - frame.eye.w * SCROLL, side * 0.5 + 0.5);
    out.textured = u32(textured);
    out.color = bolt.color;
    return out;
}

fn linear_light(display: vec3<f32>) -> vec3<f32> {
    return select(pow((display + 0.055) / 1.055, vec3<f32>(2.4)), display / 12.92, display <= vec3<f32>(0.04045));
}

@fragment
fn fragment_main(in: Varying) -> @location(0) vec4<f32> {
    let texel = textureSample(bolt_texture, bolt_sampler, in.uv);
    let fade = 1.0 - in.across * in.across;
    var color = select(vec4<f32>(in.color.rgb, in.color.a * fade), vec4<f32>(texel.rgb * in.color.rgb * texel.a * in.color.a, 1.0), in.textured == 1u);
    if (frame.fog_color.w > 0.5) {
        let fog = clamp((in.clip.w - frame.fog_range.x) / max(frame.fog_range.y - frame.fog_range.x, 1.0), 0.0, frame.fog_range.z);
        color = vec4<f32>(mix(color.rgb, frame.fog_color.rgb, fog), color.a);
    }
    return vec4<f32>(linear_light(color.rgb), color.a);
}
