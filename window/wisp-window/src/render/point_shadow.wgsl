struct PointVarying {
    @builtin(position) clip: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) world: vec3<f32>,
    @location(2) tint: vec4<f32>,
    @location(3) fade: f32,
};

@vertex
fn point_shadow_vertex(vertex: Vertex, instance: Instance) -> PointVarying {
    let world = placement(vertex, instance) * vec4<f32>(vertex.position, 1.0);
    var out: PointVarying;
    out.clip = frame.view_projection * world;
    out.uv = animated_uv(vertex, instance);
    out.world = world.xyz;
    out.tint = tint_of(instance);
    out.fade = fade_of(instance);
    return out;
}

struct PointDepth {
    @builtin(frag_depth) depth: f32,
};

@fragment
fn point_shadow_fragment(in: PointVarying) -> PointDepth {
    if (in.fade < 0.004 || textureSample(layer_texture, layer_sampler, in.uv).a * in.tint.a * in.fade < layer.cutoff) {
        discard;
    }
    var out: PointDepth;
    out.depth = clamp(length(in.world - frame.eye.xyz) / frame.camera.y, 0.0, 1.0);
    return out;
}
