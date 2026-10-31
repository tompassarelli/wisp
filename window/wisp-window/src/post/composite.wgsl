@group(0) @binding(1) var linear_sampler: sampler;
@group(0) @binding(2) var hdr: texture_2d<f32>;
@group(0) @binding(3) var bloom: texture_2d<f32>;
@group(0) @binding(4) var occlusion: texture_2d<f32>;
@group(0) @binding(5) var grade: texture_3d<f32>;
@group(0) @binding(6) var scene_depth: texture_2d<f32>;

const LUT_SIZE = 32.0;
const AGX_MIN_EV = -12.47393;
const AGX_MAX_EV = 4.026069;

fn agx_grey(light: f32) -> f32 {
    let x = clamp((log2(max(light, 1e-10)) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV), 0.0, 1.0);
    let x2 = x * x;
    let x4 = x2 * x2;
    let curved = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
    return pow(max(curved, 0.0), 2.2);
}

fn srgb_encode(linear: vec3<f32>) -> vec3<f32> {
    return select(1.055 * pow(linear, vec3<f32>(1.0 / 2.4)) - 0.055, linear * 12.92, linear <= vec3<f32>(0.0031308));
}

fn display_of(scene: vec3<f32>) -> vec3<f32> {
    let peak = max(max(scene.r, scene.g), scene.b);
    var shown = vec3<f32>(0.0);
    if (peak > 1e-6) {
        shown = clamp(scene * (agx_grey(peak) / peak), vec3<f32>(0.0), vec3<f32>(1.0));
    }
    let encoded = srgb_encode(shown);
    return textureSampleLevel(grade, linear_sampler, encoded * ((LUT_SIZE - 1.0) / LUT_SIZE) + 0.5 / LUT_SIZE, 0.0).rgb;
}

fn linear_of(display: vec3<f32>) -> vec3<f32> {
    return select(pow((display + 0.055) / 1.055, vec3<f32>(2.4)), display / 12.92, display <= vec3<f32>(0.04045));
}

fn blue_noise(pixel: vec2<f32>) -> f32 {
    let a = fract(52.9829189 * fract(dot(pixel, vec2<f32>(0.06711056, 0.00583715))));
    let b = fract(52.9829189 * fract(dot(pixel + 17.0, vec2<f32>(0.06711056, 0.00583715))));
    return a + b - 1.0;
}

const CONTACT_STEPS = 10;
const CONTACT_BIAS = 0.004;

fn full_view_position(pixel: vec2<f32>, w: f32) -> vec3<f32> {
    return view_direction(picture_ndc(pixel + 0.5)) * w;
}

fn scene_w(pixel: vec2<f32>) -> f32 {
    return textureLoad(scene_depth, clamp(vec2<i32>(pixel), vec2<i32>(0), vec2<i32>(textureDimensions(scene_depth)) - 1), 0).r;
}

fn to_view(world: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(dot(p.right.xyz, world), dot(p.up.xyz, world), -dot(p.forward.xyz, world));
}

fn picture_pixel(view: vec3<f32>) -> vec2<f32> {
    let ndc = vec2<f32>(view.x / (-view.z) / p.lens.x, view.y / (-view.z) / p.lens.y + p.lens.z);
    return vec2<f32>((ndc.x + 1.0) * 0.5 * p.rect.z + p.rect.x, (1.0 - ndc.y) * 0.5 * p.rect.w + p.rect.y);
}

fn contact_shadow(pixel: vec2<f32>, w: f32, facing: vec2<f32>) -> f32 {
    let normal = vec3<f32>(facing, sqrt(max(1.0 - dot(facing, facing), 0.0)));
    let toward_sun = to_view(p.sun_toward.xyz);
    let lit = smoothstep(0.1, 0.4, dot(normal, toward_sun)) * p.sun_toward.w;
    if (lit <= 0.0) {
        return 0.0;
    }
    let reach = p.misc.z;
    let bias = CONTACT_BIAS * w + 0.5;
    let thickness = reach * 0.8;
    let start = full_view_position(pixel, w) + normal * bias;
    let jitter = fract(52.9829189 * fract(dot(pixel, vec2<f32>(0.06711056, 0.00583715))));
    var shadow = 0.0;
    for (var step = 0; step < CONTACT_STEPS; step++) {
        let s = (f32(step) + jitter) / f32(CONTACT_STEPS);
        let point = start + toward_sun * (s * s * reach);
        if (point.z > -p.depth.x) {
            break;
        }
        let there = picture_pixel(point);
        if (there.x < p.rect.x || there.y < p.rect.y || there.x >= p.rect.x + p.rect.z || there.y >= p.rect.y + p.rect.w) {
            break;
        }
        let gap = -point.z - scene_w(there);
        let hidden = smoothstep(bias, bias * 3.0, gap) * (1.0 - smoothstep(thickness * 0.5, thickness, gap));
        shadow = max(shadow, hidden * (1.0 - s));
    }
    return shadow * lit;
}

fn gather(pixel: vec2<i32>, w: f32) -> vec3<f32> {
    let half_size = vec2<i32>(textureDimensions(occlusion));
    let home = pixel / 2;
    var sum = vec3<f32>(0.0);
    var weight = 0.0;
    var nearest = 1.0e9;
    var fallback = vec3<f32>(1.0, 0.0, 0.0);
    let toward = vec2<i32>(select(-1, 1, (pixel.x & 1) == 1), select(-1, 1, (pixel.y & 1) == 1));
    for (var y = 0; y <= 1; y++) {
        for (var x = 0; x <= 1; x++) {
            let sample = textureLoad(occlusion, clamp(home + vec2<i32>(x, y) * toward, vec2<i32>(0), half_size - 1), 0);
            let gap = abs(sample.g - w);
            let share = select(0.25, 0.75, x == 0) * select(0.25, 0.75, y == 0) * exp(-gap / (0.01 * w + 0.5));
            sum += sample.rba * share;
            weight += share;
            if (gap < nearest) {
                nearest = gap;
                fallback = sample.rba;
            }
        }
    }
    return select(sum / weight, fallback, weight < 1.0e-3);
}

@fragment
fn composite_main(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let pixel = vec2<i32>(at.xy);
    var color = textureLoad(hdr, pixel, 0).rgb;
    var w = SKY_DEPTH;
    if (p.occlusion.y > 0.0 || p.occlusion.w > 0.0) {
        w = scene_w(at.xy);
    }
    if (w < SKY_DEPTH) {
        let seen = gather(pixel, w);
        var shade = select(1.0, seen.x, p.occlusion.y > 0.0);
        if (p.occlusion.w > 0.0) {
            shade *= 1.0 - contact_shadow(at.xy - 0.5, w, seen.yz) * p.occlusion.w;
        }
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
