@group(0) @binding(1) var full_depth: texture_2d<f32>;

fn texel(pixel: vec2<i32>) -> f32 {
    return textureLoad(full_depth, min(pixel, vec2<i32>(textureDimensions(full_depth)) - 1), 0).r;
}

@fragment
fn half_depth_main(@builtin(position) at: vec4<f32>) -> @location(0) f32 {
    let home = vec2<i32>(at.xy) * 2;
    let nearest = min(min(texel(home), texel(home + vec2<i32>(1, 0))), min(texel(home + vec2<i32>(0, 1)), texel(home + vec2<i32>(1, 1))));
    return select(nearest, -1.0, nearest >= SKY_DEPTH);
}
