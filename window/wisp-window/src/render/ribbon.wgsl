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

struct Segment {
    from_above: vec4<f32>,
    from_below: vec4<f32>,
    to_above: vec4<f32>,
    to_below: vec4<f32>,
};

struct Record {
    color: vec4<f32>,
    shape: vec4<f32>,
    grid: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<storage, read> segments: array<Segment>;
@group(1) @binding(1) var ribbon_texture: texture_2d<f32>;
@group(1) @binding(2) var ribbon_sampler: sampler;
@group(1) @binding(3) var<storage, read> records: array<Record>;

struct Varying {
    @builtin(position) clip: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) cutoff: f32,
    @location(3) @interpolate(flat) flags: u32,
};

const ADDITIVE: u32 = 1u;
const KEYED: u32 = 2u;
const STRIP: u32 = 4u;

@vertex
fn vertex_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> Varying {
    var out: Varying;
    out.clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.uv = vec2<f32>(0.0);
    out.color = vec4<f32>(0.0);
    out.cutoff = 0.0;
    out.flags = 0u;
    let quad = segments[index];
    let record = records[bitcast<u32>(quad.to_above.w)];
    if (bitcast<u32>(record.grid.z) != bitcast<u32>(quad.to_below.w)) {
        return out;
    }
    let flags = u32(record.shape.w);
    var ends = array<u32, 6>(0u, 1u, 0u, 0u, 1u, 1u);
    var sides = array<u32, 6>(0u, 0u, 1u, 1u, 0u, 1u);
    let newer = ends[vertex] == 1u;
    let below = sides[vertex] == 1u;
    var from_above = quad.from_above.xyz;
    var from_below = quad.from_below.xyz;
    let to_above = quad.to_above.xyz;
    let to_below = quad.to_below.xyz;
    var alpha = record.color.a;
    var uv = vec2<f32>(0.5, select(0.0, 1.0, below));
    var fall = 0.0;
    if ((flags & STRIP) != 0u) {
        alpha = alpha * select(quad.from_above.w, quad.from_below.w, newer);
    } else {
        let life = record.shape.x;
        let now = frame.eye.w;
        var older_age = now - quad.from_above.w;
        let newer_age = now - quad.from_below.w;
        if (newer_age < 0.0 || newer_age >= life) {
            return out;
        }
        if (older_age > life) {
            let kept = (life - newer_age) / max(older_age - newer_age, 1e-6);
            from_above = mix(to_above, from_above, kept);
            from_below = mix(to_below, from_below, kept);
            older_age = life;
        }
        let age = select(older_age, newer_age, newer);
        fall = 0.5 * record.shape.y * age * age;
        let rows = max(record.grid.x, 1.0);
        let columns = max(record.grid.y, 1.0);
        let slot = record.shape.z;
        let column = slot % columns;
        let row = floor(slot / columns) % rows;
        uv = vec2<f32>((column + age / life) / columns, (row + select(0.0, 1.0, below)) / rows);
    }
    let edge = select(select(from_above, from_below, below), select(to_above, to_below, below), newer);
    out.clip = frame.view_projection * vec4<f32>(edge - vec3<f32>(0.0, 0.0, fall), 1.0);
    out.uv = uv;
    out.color = vec4<f32>(record.color.rgb, alpha);
    out.cutoff = select(0.0, 0.75, (flags & KEYED) != 0u);
    out.flags = flags;
    return out;
}

fn linear_light(display: vec3<f32>) -> vec3<f32> {
    return select(pow((display + 0.055) / 1.055, vec3<f32>(2.4)), display / 12.92, display <= vec3<f32>(0.04045));
}

@fragment
fn fragment_main(in: Varying) -> @location(0) vec4<f32> {
    let sampled = textureSample(ribbon_texture, ribbon_sampler, in.uv);
    let across = 2.0 * in.uv.y - 1.0;
    let texel = select(sampled, vec4<f32>(1.0, 1.0, 1.0, 1.0 - across * across), (in.flags & STRIP) != 0u);
    var color = texel * in.color;
    if (color.a < in.cutoff) {
        discard;
    }
    if (frame.fog_color.w > 0.5) {
        let fog = clamp((in.clip.w - frame.fog_range.x) / max(frame.fog_range.y - frame.fog_range.x, 1.0), 0.0, frame.fog_range.z);
        color = vec4<f32>(mix(color.rgb, frame.fog_color.rgb, fog), color.a);
    }
    // Classic adds a ribbon in display colour, as it does a particle, so its alpha scales the colour before the linear conversion.
    if ((in.flags & ADDITIVE) != 0u) {
        return vec4<f32>(linear_light(color.rgb * color.a), color.a);
    }
    return vec4<f32>(linear_light(color.rgb), color.a);
}
