@group(0) @binding(1) var half_depth: texture_2d<f32>;

const TAPS = 10;

fn depth_at(pixel: vec2<i32>) -> f32 {
    return textureLoad(half_depth, clamp(pixel, vec2<i32>(0), vec2<i32>(textureDimensions(half_depth)) - 1), 0).r;
}

fn view_position(pixel: vec2<i32>, w: f32) -> vec3<f32> {
    return view_direction(picture_ndc(vec2<f32>(pixel) * 2.0 + 1.0)) * w;
}

fn noise(pixel: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(pixel, vec2<f32>(0.06711056, 0.00583715))));
}

@fragment
fn occlusion_main(@builtin(position) at: vec4<f32>) -> @location(0) vec2<f32> {
    let pixel = vec2<i32>(at.xy);
    let w = depth_at(pixel);
    if (w < 0.0) {
        return vec2<f32>(1.0, 1.0e6);
    }
    let centre = view_position(pixel, w);
    let right = view_position(pixel + vec2<i32>(1, 0), depth_at(pixel + vec2<i32>(1, 0)));
    let left = view_position(pixel - vec2<i32>(1, 0), depth_at(pixel - vec2<i32>(1, 0)));
    let down = view_position(pixel + vec2<i32>(0, 1), depth_at(pixel + vec2<i32>(0, 1)));
    let above = view_position(pixel - vec2<i32>(0, 1), depth_at(pixel - vec2<i32>(0, 1)));
    let dx = select(centre - left, right - centre, abs(right.z - centre.z) < abs(left.z - centre.z));
    let dy = select(centre - above, down - centre, abs(down.z - centre.z) < abs(above.z - centre.z));
    let normal = normalize(cross(dy, dx));
    let radius = p.occlusion.x;
    let pixels_per_unit = p.rect.z * 0.25 / (p.lens.x * w);
    let reach = clamp(radius * pixels_per_unit, 2.0, 48.0);
    let turn = noise(at.xy) * 6.2831853;
    var sum = 0.0;
    for (var tap = 0; tap < TAPS; tap++) {
        let angle = turn + f32(tap) * 2.399963;
        let distance = sqrt((f32(tap) + 0.5) / f32(TAPS)) * reach;
        let there = pixel + vec2<i32>(round(vec2<f32>(cos(angle), sin(angle)) * distance));
        let sample_w = depth_at(there);
        if (sample_w < 0.0) {
            continue;
        }
        let v = view_position(there, sample_w) - centre;
        let near = max(dot(v, normal) - p.occlusion.z * w, 0.0);
        let falloff = 1.0 - smoothstep(radius * 0.6, radius * 1.4, length(v));
        sum += near / (dot(v, v) + 0.01 * radius) * falloff;
    }
    let occluded = clamp(sum * radius * 2.0 / f32(TAPS), 0.0, 1.0);
    return vec2<f32>(1.0 - occluded * p.occlusion.y, w);
}
