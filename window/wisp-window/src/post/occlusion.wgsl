@group(0) @binding(1) var half_depth: texture_2d<f32>;

const SLICES = 2;
const STEPS = 6;
const PI = 3.14159265;
const HALF_PI = 1.57079633;
const FALLOFF = 0.615;

fn depth_at(pixel: vec2<i32>) -> f32 {
    return textureLoad(half_depth, clamp(pixel, vec2<i32>(0), vec2<i32>(textureDimensions(half_depth)) - 1), 0).r;
}

fn bayer(pixel: vec2<i32>) -> f32 {
    let x = u32(pixel.x) & 3u;
    let y = u32(pixel.y) & 3u;
    let both = x ^ y;
    return f32((both & 1u) * 8u + (y & 1u) * 4u + ((both >> 1u) & 1u) * 2u + ((y >> 1u) & 1u)) / 16.0;
}

fn noise(pixel: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(pixel, vec2<f32>(0.06711056, 0.00583715))));
}

fn lateral(pixel: vec2<i32>, step: vec2<i32>, w: f32, centre: vec3<f32>) -> vec3<f32> {
    let there = depth_at(pixel + step);
    let near = select(w, there, there >= 0.0);
    return half_view_position(pixel + step, near) - centre;
}

fn surface_normal(pixel: vec2<i32>, w: f32, centre: vec3<f32>) -> vec3<f32> {
    let right = lateral(pixel, vec2<i32>(1, 0), w, centre);
    let left = -lateral(pixel, vec2<i32>(-1, 0), w, centre);
    let down = lateral(pixel, vec2<i32>(0, 1), w, centre);
    let above = -lateral(pixel, vec2<i32>(0, -1), w, centre);
    let dx = select(left, right, abs(right.z) < abs(left.z));
    let dy = select(above, down, abs(down.z) < abs(above.z));
    return normalize(cross(dy, dx));
}

fn horizon_cosine(pixel: vec2<i32>, centre: vec3<f32>, toward_eye: vec3<f32>, floor_cosine: f32, current: f32, radius: f32) -> f32 {
    let w = depth_at(pixel);
    if (w < 0.0) {
        return current;
    }
    let delta = half_view_position(pixel, w) - centre;
    let distance = max(length(delta), 1.0e-3);
    let fade = clamp((radius - distance) / (radius * FALLOFF), 0.0, 1.0);
    return max(current, mix(floor_cosine, dot(delta / distance, toward_eye), fade));
}

fn slice_visibility(pixel: vec2<i32>, centre: vec3<f32>, toward_eye: vec3<f32>, normal: vec3<f32>, phi: f32, reach: f32, jitter: f32, radius: f32) -> f32 {
    let direction = vec2<f32>(cos(phi), sin(phi));
    let direction3 = vec3<f32>(direction, 0.0);
    let ortho = direction3 - dot(direction3, toward_eye) * toward_eye;
    let axis = cross(direction3, toward_eye);
    let projected = normal - axis * dot(normal, axis);
    let length_projected = length(projected);
    if (length_projected < 1.0e-4) {
        return 1.0;
    }
    let cos_normal = clamp(dot(projected, toward_eye) / length_projected, 0.0, 1.0);
    let n = select(1.0, -1.0, dot(ortho, projected) < 0.0) * acos(cos_normal);
    let floor_forward = cos(n + HALF_PI);
    let floor_back = cos(n - HALF_PI);
    var cos_forward = floor_forward;
    var cos_back = floor_back;
    for (var step = 0; step < STEPS; step++) {
        let s = (f32(step) + jitter) / f32(STEPS);
        let offset = vec2<i32>(round(vec2<f32>(direction.x, -direction.y) * (1.0 + s * s * reach)));
        cos_forward = horizon_cosine(pixel + offset, centre, toward_eye, floor_forward, cos_forward, radius);
        cos_back = horizon_cosine(pixel - offset, centre, toward_eye, floor_back, cos_back, radius);
    }
    let h_back = n + clamp(-acos(clamp(cos_back, -1.0, 1.0)) - n, -HALF_PI, HALF_PI);
    let h_forward = n + clamp(acos(clamp(cos_forward, -1.0, 1.0)) - n, -HALF_PI, HALF_PI);
    let arc_back = (cos_normal + 2.0 * h_back * sin(n) - cos(2.0 * h_back - n)) * 0.25;
    let arc_forward = (cos_normal + 2.0 * h_forward * sin(n) - cos(2.0 * h_forward - n)) * 0.25;
    return length_projected * (arc_back + arc_forward);
}

@fragment
fn occlusion_main(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let pixel = vec2<i32>(at.xy);
    let w = depth_at(pixel);
    if (w < 0.0) {
        return vec4<f32>(1.0, SKY_DEPTH, 0.0, 0.0);
    }
    let centre = half_view_position(pixel, w);
    let normal = surface_normal(pixel, w, centre);
    let toward_eye = normalize(-centre);
    let radius = p.occlusion.x;
    let pixels_per_unit = p.rect.z * 0.25 / (p.lens.x * w);
    let reach = clamp(radius * pixels_per_unit, 3.0, 40.0);
    let spin = bayer(pixel);
    let jitter = noise(at.xy);
    var visibility = 0.0;
    for (var slice = 0; slice < SLICES; slice++) {
        let phi = PI * (spin + f32(slice) / f32(SLICES));
        visibility += slice_visibility(pixel, centre, toward_eye, normal, phi, reach, jitter, radius);
    }
    let shade = clamp(1.0 - (1.0 - visibility / f32(SLICES)) * p.occlusion.y, 0.0, 1.0);
    return vec4<f32>(shade, w, normal.x, normal.y);
}
