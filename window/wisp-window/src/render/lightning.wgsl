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
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<storage, read> bolts: array<Bolt>;

struct Varying {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) across: f32,
};

const SEGMENTS: u32 = 24u;

fn hash(value: u32) -> f32 {
    var x = value * 747796405u + 2891336453u;
    x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
    x = (x >> 22u) ^ x;
    return f32(x & 0xffffffu) / 8388608.0 - 1.0;
}

@vertex
fn vertex_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Varying {
    let bolt = bolts[instance / 2u];
    let core = instance % 2u == 1u;
    let step = vertex / 2u;
    let side = select(-1.0, 1.0, vertex % 2u == 0u);
    let along = f32(step) / f32(SEGMENTS);
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
    let amplitude = min(reach * 0.06, 60.0) * envelope;
    let point = straight + wide * hash(seed) * amplitude + tall * hash(seed + 977u) * amplitude;
    let distance_to_eye = length(frame.eye.xyz - point);
    let half_width = max(distance_to_eye * select(0.0075, 0.0022, core), 1.0);
    var out: Varying;
    out.clip = frame.view_projection * vec4<f32>(point + wide * side * half_width, 1.0);
    out.across = side;
    out.color = select(vec4<f32>(bolt.color.rgb, bolt.color.a * 0.55), vec4<f32>(mix(bolt.color.rgb, vec3<f32>(1.0), 0.75), bolt.color.a), core);
    return out;
}

@fragment
fn fragment_main(in: Varying) -> @location(0) vec4<f32> {
    let fade = 1.0 - in.across * in.across;
    var color = vec4<f32>(in.color.rgb, in.color.a * fade);
    if (frame.fog_color.w > 0.5) {
        let fog = clamp((in.clip.w - frame.fog_range.x) / max(frame.fog_range.y - frame.fog_range.x, 1.0), 0.0, frame.fog_range.z);
        color = vec4<f32>(mix(color.rgb, frame.fog_color.rgb, fog), color.a);
    }
    return color;
}
