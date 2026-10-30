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

struct Weather {
    center: vec4<f32>,
    rect: vec4<f32>,
    color: vec4<f32>,
    shape: vec4<f32>,
    wind: vec4<f32>,
    volume: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<storage, read> weathers: array<Weather>;

const STRIDE: u32 = 16384u;
const FLAKES: f32 = 0.0;
const FOG: f32 = 1.0;
const RAYS: f32 = 2.0;

struct Varying {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) local: vec2<f32>,
    @location(2) reach: f32,
    @location(3) kind: f32,
};

fn hash(value: u32) -> f32 {
    var x = value * 747796405u + 2891336453u;
    x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
    x = (x >> 22u) ^ x;
    return f32(x & 0xffffffu) / 16777216.0;
}

fn gust(time: f32) -> f32 {
    return time + 0.6 * sin(0.45 * time) + 0.25 * sin(1.3 * time + 1.7);
}

fn gust_rate(time: f32) -> f32 {
    return 1.0 + 0.27 * cos(0.45 * time) + 0.325 * cos(1.3 * time + 1.7);
}

fn hidden() -> Varying {
    var out: Varying;
    out.clip = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    return out;
}

fn flake(weather: Weather, seed: u32, vertex: u32) -> Varying {
    let time = frame.eye.w;
    let box = vec3<f32>(weather.volume.x, weather.volume.x, weather.volume.y);
    let base = vec3<f32>(hash(seed * 4u), hash(seed * 4u + 1u), hash(seed * 4u + 2u));
    let layer = hash(seed * 4u + 3u);
    let depth_speed = 0.65 + 0.7 * layer;
    let rate = gust_rate(time);
    let velocity = vec3<f32>(weather.wind.xy * rate, -weather.shape.z * depth_speed);
    let travel = vec3<f32>(weather.wind.xy * gust(time), -weather.shape.z * depth_speed * time);
    let drift = (base * box + travel - weather.center.xyz) / box;
    var at = weather.center.xyz + (fract(drift) - 0.5) * box;
    let sway = weather.wind.z * (0.5 + layer);
    at += vec3<f32>(sin(time * (0.7 + layer) + base.x * 40.0), cos(time * (0.9 + layer) + base.y * 40.0), 0.0) * sway;
    if (at.x < weather.rect.x || at.x > weather.rect.z || at.y < weather.rect.y || at.y > weather.rect.w) {
        return hidden();
    }
    let tail_at = at - velocity * weather.wind.w;
    let head = frame.view_projection * vec4<f32>(at, 1.0);
    let tail = frame.view_projection * vec4<f32>(tail_at, 1.0);
    if (head.w < weather.volume.z || tail.w < weather.volume.z) {
        return hidden();
    }
    let aspect = frame.view_projection[1][1] / frame.view_projection[0][0];
    let size = weather.shape.y * (0.45 + 1.1 * layer * layer);
    let half_width = size * frame.view_projection[0][0];
    let head_ndc = head.xy / head.w;
    let tail_ndc = tail.xy / tail.w;
    let span = (head_ndc - tail_ndc) * vec2<f32>(aspect, 1.0);
    let per_head = half_width / head.w;
    let per_tail = half_width / tail.w;
    let reach = length(span) / max(per_head, 1e-6);
    var axis = vec2<f32>(0.0, -1.0);
    if (length(span) > 1e-6) {
        axis = normalize(span);
    }
    let normal = vec2<f32>(-axis.y, axis.x);
    let is_head = vertex >= 2u;
    let side = select(-1.0, 1.0, (vertex & 1u) == 1u);
    let center = select(tail_ndc, head_ndc, is_head);
    let per = select(per_tail, per_head, is_head);
    let w = select(tail.w, head.w, is_head);
    let along = select(-1.0, 1.0 + 0.0, is_head);
    let corner = (axis * along + normal * side) * per;
    let ndc = center + corner * vec2<f32>(1.0 / aspect, 1.0);
    var out: Varying;
    out.clip = vec4<f32>(ndc * w, select(tail.z, head.z, is_head), w);
    out.local = vec2<f32>(select(along, reach + along, is_head), side);
    out.reach = reach;
    out.kind = FLAKES;
    let near = smoothstep(weather.volume.z, weather.volume.z * 3.0, head.w);
    let far = 1.0 - smoothstep(weather.volume.w * 0.55, weather.volume.w, head.w);
    let twinkle = 0.7 + 0.3 * layer;
    out.color = vec4<f32>(weather.color.rgb, weather.color.a * near * far * twinkle);
    return out;
}

fn blob(weather: Weather, seed: u32, vertex: u32) -> Varying {
    let time = frame.eye.w;
    let box = vec3<f32>(weather.volume.x, weather.volume.x, weather.volume.y);
    let base = vec3<f32>(hash(seed * 4u), hash(seed * 4u + 1u), hash(seed * 4u + 2u));
    let layer = hash(seed * 4u + 3u);
    let travel = vec3<f32>(weather.wind.xy * gust(time) * (0.4 + layer), 0.0);
    let drift = (base * box + travel - weather.center.xyz) / box;
    var at = weather.center.xyz + (fract(drift) - 0.5) * box;
    at.z = weather.center.z - box.z * 0.5 + base.z * base.z * box.z * 0.45 + sin(time * 0.2 + base.x * 30.0) * weather.shape.z;
    if (at.x < weather.rect.x || at.x > weather.rect.z || at.y < weather.rect.y || at.y > weather.rect.w) {
        return hidden();
    }
    let size = weather.shape.y * (0.6 + 0.8 * layer);
    let corner = vec2<f32>(select(-1.0, 1.0, (vertex & 1u) == 1u), select(-1.0, 1.0, vertex >= 2u));
    let turn = time * 0.03 + base.y * 6.283;
    let spin = vec2<f32>(corner.x * cos(turn) - corner.y * sin(turn), corner.x * sin(turn) + corner.y * cos(turn));
    let point = at + (frame.right.xyz * spin.x + frame.up.xyz * spin.y) * size;
    var out: Varying;
    out.clip = frame.view_projection * vec4<f32>(point, 1.0);
    out.local = corner;
    out.kind = FOG;
    let centre = frame.view_projection * vec4<f32>(at, 1.0);
    let near = smoothstep(size * 2.5, size * 4.5, length(at - frame.eye.xyz));
    let far = 1.0 - smoothstep(weather.volume.w * 0.5, weather.volume.w, centre.w);
    let thicken = 0.6 + 0.8 * smoothstep(0.0, weather.volume.w * 0.5, centre.w);
    out.color = vec4<f32>(weather.color.rgb, weather.color.a * near * far * thicken);
    return out;
}

fn shaft(weather: Weather, seed: u32, vertex: u32) -> Varying {
    let time = frame.eye.w;
    let box = weather.volume.x;
    let base = vec2<f32>(hash(seed * 4u), hash(seed * 4u + 1u));
    let width = weather.shape.y * (0.5 + hash(seed * 4u + 2u));
    let phase = hash(seed * 4u + 3u) * 6.283;
    let lean = normalize(vec3<f32>(weather.wind.x, weather.wind.y, -1.0));
    let top = vec3<f32>(weather.center.xy + (base - 0.5) * box * 0.8, weather.center.z + weather.volume.y * 0.5) - lean * 0.0;
    let bottom = top + lean * (weather.volume.y * 1.1);
    if (top.x < weather.rect.x || top.x > weather.rect.z || top.y < weather.rect.y || top.y > weather.rect.w) {
        return hidden();
    }
    let along = f32(vertex >> 1u);
    let point = mix(top, bottom, along);
    var wide = cross(bottom - top, frame.eye.xyz - point);
    if (dot(wide, wide) < 1e-6) {
        wide = frame.right.xyz;
    }
    wide = normalize(wide);
    let side = select(-1.0, 1.0, (vertex & 1u) == 1u);
    let spread = width * (0.55 + 0.9 * along);
    var out: Varying;
    out.clip = frame.view_projection * vec4<f32>(point + wide * side * spread, 1.0);
    out.local = vec2<f32>(along, side);
    out.kind = RAYS;
    let flicker = 0.55 + 0.45 * sin(time * 0.35 + phase) * sin(time * 0.83 + phase * 2.1);
    let centre = frame.view_projection * vec4<f32>(top, 1.0);
    let near = smoothstep(weather.volume.z, weather.volume.z * 4.0, out.clip.w);
    out.color = vec4<f32>(weather.color.rgb, weather.color.a * flicker * near);
    return out;
}

@vertex
fn vertex_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> Varying {
    let slot = instance / STRIDE;
    let weather = weathers[slot];
    let seed = instance % STRIDE + slot * 7919u;
    if (weather.shape.x == FOG) {
        return blob(weather, seed, vertex);
    }
    if (weather.shape.x == RAYS) {
        return shaft(weather, seed, vertex);
    }
    return flake(weather, seed, vertex);
}

@fragment
fn fragment_main(in: Varying) -> @location(0) vec4<f32> {
    var alpha = in.color.a;
    if (in.kind == FLAKES) {
        let nearest = clamp(in.local.x, 0.0, in.reach);
        let from_axis = length(vec2<f32>(in.local.x - nearest, in.local.y));
        let body = clamp(1.0 - from_axis, 0.0, 1.0);
        let trail = select(1.0, mix(0.2, 1.0, clamp(in.local.x / max(in.reach, 1e-3), 0.0, 1.0)), in.reach > 0.6);
        alpha *= body * body * trail;
    } else if (in.kind == FOG) {
        let radial = clamp(1.0 - dot(in.local, in.local), 0.0, 1.0);
        alpha *= radial * radial;
    } else {
        let across = clamp(1.0 - abs(in.local.y), 0.0, 1.0);
        let lengthwise = smoothstep(0.0, 0.18, in.local.x) * (1.0 - smoothstep(0.55, 1.0, in.local.x));
        alpha *= across * across * lengthwise;
    }
    return vec4<f32>(in.color.rgb, alpha);
}
