@group(0) @binding(1) var source: texture_2d<f32>;

const RADIUS = 2;
const SPATIAL = 0.25;

fn texel(pixel: vec2<i32>) -> vec4<f32> {
    return textureLoad(source, clamp(pixel, vec2<i32>(0), vec2<i32>(textureDimensions(source)) - 1), 0);
}

fn normal_of(texel: vec4<f32>) -> vec3<f32> {
    return vec3<f32>(texel.b, texel.a, sqrt(max(1.0 - texel.b * texel.b - texel.a * texel.a, 0.0)));
}

fn blur(pixel: vec2<i32>, step: vec2<i32>) -> vec4<f32> {
    let centre = texel(pixel);
    if (centre.g >= SKY_DEPTH) {
        return centre;
    }
    let position = half_view_position(pixel, centre.g);
    let normal = normal_of(centre);
    let reach = 0.004 * centre.g + 1.0;
    var sum = centre.r;
    var weight = 1.0;
    for (var k = -RADIUS; k <= RADIUS; k++) {
        if (k == 0) {
            continue;
        }
        let there = pixel + step * k;
        let sample = texel(there);
        if (sample.g >= SKY_DEPTH) {
            continue;
        }
        let off_plane = dot(normal, half_view_position(there, sample.g) - position);
        let facing = max(dot(normal, normal_of(sample)), 0.0);
        let share = exp(-f32(k * k) * SPATIAL - off_plane * off_plane / (2.0 * reach * reach)) * pow(facing, 4.0);
        sum += sample.r * share;
        weight += share;
    }
    return vec4<f32>(sum / weight, centre.gba);
}

@fragment
fn denoise_across(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    return blur(vec2<i32>(at.xy), vec2<i32>(1, 0));
}

@fragment
fn denoise_down(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    return blur(vec2<i32>(at.xy), vec2<i32>(0, 1));
}
