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

struct Spec {
    first: vec4<f32>,
    second: vec4<f32>,
    third: vec4<f32>,
    scaling: vec4<f32>,
    head_frames: vec4<f32>,
    tail_frames: vec4<f32>,
    grid: vec4<f32>,
};

struct Particle {
    origin: vec4<f32>,
    velocity: vec4<f32>,
    extra: vec4<f32>,
    placed: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> specs: array<Spec>;
@group(1) @binding(0) var<storage, read> particles: array<Particle>;
@group(1) @binding(1) var particle_texture: texture_2d<f32>;
@group(1) @binding(2) var particle_sampler: sampler;

struct Varying {
    @builtin(position) clip: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) cutoff: f32,
};

const HEAD: u32 = 1u;
const TAIL: u32 = 2u;
const FLAT: u32 = 4u;
const KEYED: u32 = 8u;

@vertex
fn vertex_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> Varying {
    var out: Varying;
    out.clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.uv = vec2<f32>(0.0);
    out.color = vec4<f32>(0.0);
    out.cutoff = 0.0;
    let particle = particles[index];
    let age = frame.eye.w - particle.origin.w;
    let life = particle.velocity.w;
    if (age < 0.0 || age >= life) {
        return out;
    }
    let spec = specs[bitcast<u32>(particle.extra.z)];
    let flags = u32(spec.grid.w);
    let is_tail = vertex >= 6u;
    if ((is_tail && (flags & TAIL) == 0u) || (!is_tail && (flags & HEAD) == 0u)) {
        return out;
    }
    var corners = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u);
    let corner = corners[vertex % 6u];
    let side = select(-1.0, 1.0, corner >= 2u);
    let rise = select(-1.0, 1.0, corner % 2u == 0u);

    let along = age / life;
    let middle = spec.scaling.w;
    let first_half = middle > 0.0 && (along < middle || middle >= 1.0);
    var t = along;
    if (middle > 0.0 && middle < 1.0) {
        t = select((along - middle) / (1.0 - middle), along / middle, first_half);
    }
    let size = mix(select(spec.scaling.y, spec.scaling.x, first_half), select(spec.scaling.z, spec.scaling.y, first_half), t) * particle.placed.x;
    let origin = select(spec.second, spec.first, first_half);
    let to = select(spec.third, spec.second, first_half);
    var color = mix(origin, to, t);
    color.a = color.a * particle.extra.w;

    let gravity = particle.extra.x;
    let at = particle.origin.xyz + particle.velocity.xyz * age - vec3<f32>(0.0, 0.0, 0.5 * gravity * age * age);
    let moving = particle.velocity.xyz - vec3<f32>(0.0, 0.0, gravity * age);

    var offset: vec3<f32>;
    var frames: vec2<f32>;
    if (is_tail) {
        frames = select(spec.tail_frames.zw, spec.tail_frames.xy, first_half);
        var across = cross(moving, frame.eye.xyz - at);
        if (dot(across, across) < 1e-6) {
            across = frame.right.xyz;
        }
        across = normalize(across) * size * rise;
        offset = across - select(vec3<f32>(0.0), moving * spec.grid.z, side > 0.0);
    } else {
        frames = select(spec.head_frames.zw, spec.head_frames.xy, first_half);
        if ((flags & FLAT) != 0u) {
            let c = cos(particle.extra.y);
            let s = sin(particle.extra.y);
            offset = vec3<f32>(side * c - rise * s, side * s + rise * c, 0.0) * size;
        } else {
            offset = (frame.right.xyz * side + frame.up.xyz * rise) * size;
        }
    }
    let rows = spec.grid.x;
    let columns = spec.grid.y;
    let count = max(rows * columns, 1.0);
    let cell = floor(mix(frames.x, frames.y, t) + 0.5) % count;
    let column = cell % columns;
    let row = floor(cell / columns);
    out.uv = vec2<f32>((column + select(0.0, 1.0, side > 0.0)) / columns, (row + select(1.0, 0.0, rise > 0.0)) / rows);
    out.clip = frame.view_projection * vec4<f32>(at + offset, 1.0);
    out.color = color;
    out.cutoff = select(0.0, 0.75, (flags & KEYED) != 0u);
    return out;
}

@fragment
fn fragment_main(in: Varying) -> @location(0) vec4<f32> {
    let texel = textureSample(particle_texture, particle_sampler, in.uv);
    var color = texel * in.color;
    if (color.a < in.cutoff) {
        discard;
    }
    if (frame.fog_color.w > 0.5) {
        let fog = clamp((in.clip.w - frame.fog_range.x) / max(frame.fog_range.y - frame.fog_range.x, 1.0), 0.0, frame.fog_range.z);
        color = vec4<f32>(mix(color.rgb, frame.fog_color.rgb, fog), color.a);
    }
    return color;
}
