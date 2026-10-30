@group(0) @binding(1) var linear_sampler: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;

fn tap(uv: vec2<f32>, offset: vec2<f32>, texel: vec2<f32>) -> vec3<f32> {
    return textureSampleLevel(source, linear_sampler, uv + offset * texel, 0.0).rgb;
}

fn karis(color: vec3<f32>) -> f32 {
    return 1.0 / (1.0 + luminance(color));
}

fn bright(color: vec3<f32>) -> vec3<f32> {
    let level = luminance(color);
    let knee = p.bloom.y;
    let soft = clamp(level - p.bloom.x + knee, 0.0, 2.0 * knee);
    let gain = max(soft * soft / (4.0 * knee + 1e-5), level - p.bloom.x) / max(level, 1e-4);
    return color * max(gain, 0.0);
}

fn downsample(uv: vec2<f32>, texel: vec2<f32>) -> array<vec3<f32>, 5> {
    let a = tap(uv, vec2<f32>(-2.0, -2.0), texel);
    let b = tap(uv, vec2<f32>(0.0, -2.0), texel);
    let c = tap(uv, vec2<f32>(2.0, -2.0), texel);
    let d = tap(uv, vec2<f32>(-2.0, 0.0), texel);
    let e = tap(uv, vec2<f32>(0.0, 0.0), texel);
    let f = tap(uv, vec2<f32>(2.0, 0.0), texel);
    let g = tap(uv, vec2<f32>(-2.0, 2.0), texel);
    let h = tap(uv, vec2<f32>(0.0, 2.0), texel);
    let i = tap(uv, vec2<f32>(2.0, 2.0), texel);
    let j = tap(uv, vec2<f32>(-1.0, -1.0), texel);
    let k = tap(uv, vec2<f32>(1.0, -1.0), texel);
    let l = tap(uv, vec2<f32>(-1.0, 1.0), texel);
    let m = tap(uv, vec2<f32>(1.0, 1.0), texel);
    return array<vec3<f32>, 5>((j + k + l + m) * 0.25, (a + b + d + e) * 0.25, (b + c + e + f) * 0.25, (d + e + g + h) * 0.25, (e + f + h + i) * 0.25);
}

@fragment
fn prefilter_main(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(source));
    let texel = 1.0 / size;
    let uv = at.xy * 2.0 / size;
    var total = vec3<f32>(0.0);
    var weight = 0.0;
    for (var index = 0; index < 4; index++) {
        let corner = vec2<f32>(select(-1.0, 1.0, (index & 1) == 1), select(-1.0, 1.0, (index & 2) == 2));
        let box = bright(tap(uv, corner, texel));
        let share = karis(box);
        total += box * share;
        weight += share;
    }
    return vec4<f32>(total / max(weight, 1e-5), 1.0);
}

@fragment
fn down_main(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(source));
    let texel = 1.0 / size;
    var boxes = downsample(at.xy * 2.0 / size, texel);
    return vec4<f32>(boxes[0] * 0.5 + (boxes[1] + boxes[2] + boxes[3] + boxes[4]) * 0.125, 1.0);
}

@fragment
fn up_main(@builtin(position) at: vec4<f32>, ) -> @location(0) vec4<f32> {
    let destination = vec2<f32>(textureDimensions(source)) * 2.0;
    let uv = at.xy / destination;
    let texel = 1.0 / vec2<f32>(textureDimensions(source));
    var sum = tap(uv, vec2<f32>(0.0, 0.0), texel) * 4.0;
    sum += (tap(uv, vec2<f32>(-1.0, 0.0), texel) + tap(uv, vec2<f32>(1.0, 0.0), texel) + tap(uv, vec2<f32>(0.0, -1.0), texel) + tap(uv, vec2<f32>(0.0, 1.0), texel)) * 2.0;
    sum += tap(uv, vec2<f32>(-1.0, -1.0), texel) + tap(uv, vec2<f32>(1.0, -1.0), texel) + tap(uv, vec2<f32>(-1.0, 1.0), texel) + tap(uv, vec2<f32>(1.0, 1.0), texel);
    return vec4<f32>(sum / 16.0, 1.0);
}
