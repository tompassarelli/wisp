@group(0) @binding(1) var scene_depth: texture_depth_multisampled_2d;

@fragment
fn depth_main(@builtin(position) at: vec4<f32>) -> @location(0) f32 {
    let raw = textureLoad(scene_depth, vec2<i32>(at.xy), 0);
    return select(view_depth(raw), SKY_DEPTH, raw >= 1.0);
}
