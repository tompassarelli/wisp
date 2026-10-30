@group(0) @binding(1) var scene_depth: texture_depth_multisampled_2d;

@fragment
fn depth_main(@builtin(position) at: vec4<f32>) -> @location(0) f32 {
    let size = vec2<i32>(textureDimensions(scene_depth));
    let home = vec2<i32>(at.xy) * 2;
    let nearest = min(
        min(textureLoad(scene_depth, min(home, size - 1), 0), textureLoad(scene_depth, min(home + vec2<i32>(1, 0), size - 1), 0)),
        min(textureLoad(scene_depth, min(home + vec2<i32>(0, 1), size - 1), 0), textureLoad(scene_depth, min(home + vec2<i32>(1, 1), size - 1), 0)),
    );
    return select(view_depth(nearest), -1.0, nearest >= 1.0);
}
