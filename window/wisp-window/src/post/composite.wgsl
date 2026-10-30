@group(0) @binding(1) var linear_sampler: sampler;
@group(0) @binding(2) var hdr: texture_2d<f32>;
@group(0) @binding(3) var bloom: texture_2d<f32>;
@group(0) @binding(4) var occlusion: texture_2d<f32>;
@group(0) @binding(5) var grade: texture_3d<f32>;
@group(0) @binding(6) var scene_depth: texture_depth_multisampled_2d;

const LUT_SIZE = 64.0;
const LUT_MIN_EV = -10.0;
const LUT_MAX_EV = 6.0;

fn display_of(scene: vec3<f32>) -> vec3<f32> {
    let ev = clamp((log2(max(scene, vec3<f32>(1e-6))) - LUT_MIN_EV) / (LUT_MAX_EV - LUT_MIN_EV), vec3<f32>(0.0), vec3<f32>(1.0));
    return textureSampleLevel(grade, linear_sampler, ev * ((LUT_SIZE - 1.0) / LUT_SIZE) + 0.5 / LUT_SIZE, 0.0).rgb;
}

fn linear_of(display: vec3<f32>) -> vec3<f32> {
    return select(pow((display + 0.055) / 1.055, vec3<f32>(2.4)), display / 12.92, display <= vec3<f32>(0.04045));
}

fn blue_noise(pixel: vec2<f32>) -> f32 {
    let a = fract(52.9829189 * fract(dot(pixel, vec2<f32>(0.06711056, 0.00583715))));
    let b = fract(52.9829189 * fract(dot(pixel + 17.0, vec2<f32>(0.06711056, 0.00583715))));
    return a + b - 1.0;
}

fn occluded(pixel: vec2<i32>, w: f32) -> f32 {
    let half_size = vec2<i32>(textureDimensions(occlusion));
    let home = pixel / 2;
    var sum = 0.0;
    var weight = 0.0;
    let toward = vec2<i32>(select(-1, 1, (pixel.x & 1) == 1), select(-1, 1, (pixel.y & 1) == 1));
    for (var y = 0; y <= 1; y++) {
        for (var x = 0; x <= 1; x++) {
            let sample = textureLoad(occlusion, clamp(home + vec2<i32>(x, y) * toward, vec2<i32>(0), half_size - 1), 0);
            let close = exp(-abs(sample.g - w) / (0.04 * w + 1.0));
            let share = close;
            sum += sample.r * share;
            weight += share;
        }
    }
    return sum / max(weight, 1e-4);
}

@fragment
fn composite_main(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let pixel = vec2<i32>(at.xy);
    var color = textureLoad(hdr, pixel, 0).rgb;
    let raw = textureLoad(scene_depth, pixel, 0);
    if (raw < 1.0 && p.occlusion.y > 0.0) {
        let shade = occluded(pixel, view_depth(raw));
        color *= mix(shade, 1.0, smoothstep(0.8, 2.5, luminance(color)));
    }
    let uv = (at.xy) / vec2<f32>(textureDimensions(hdr));
    color += textureSampleLevel(bloom, linear_sampler, uv, 0.0).rgb * p.bloom.z;
    var display = display_of(color * p.misc.w) + blue_noise(at.xy) / 255.0;
    if (p.misc.y > 0.5) {
        display = linear_of(clamp(display, vec3<f32>(0.0), vec3<f32>(1.0)));
    }
    return vec4<f32>(display, 1.0);
}
