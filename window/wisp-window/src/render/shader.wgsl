struct Layer {
    kind: u32,
    cutoff: f32,
    geoset_slot: u32,
    layer_slot: u32,
    ignores_texture_alpha: u32,
    unshaded: u32,
};

@group(0) @binding(2) var<storage, read> slot_colors: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> uv_rows: array<vec4<f32>>;
@group(1) @binding(0) var layer_texture: texture_2d<f32>;
@group(1) @binding(1) var layer_sampler: sampler;
@group(1) @binding(2) var<uniform> layer: Layer;

struct Varying {
    @builtin(position) clip: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) light: vec3<f32>,
    @location(2) tint: vec4<f32>,
    @location(3) team: vec3<f32>,
    @location(4) fade: f32,
    @location(5) world_z: f32,
};

@vertex
fn vertex_main(vertex: Vertex, instance: Instance) -> Varying {
    let model = mat4x4<f32>(instance.model0, instance.model1, instance.model2, instance.model3);
    let skin = bones[instance.base.x + vertex.bones.x] * vertex.weights.x
        + bones[instance.base.x + vertex.bones.y] * vertex.weights.y
        + bones[instance.base.x + vertex.bones.z] * vertex.weights.z
        + bones[instance.base.x + vertex.bones.w] * vertex.weights.w;
    let placed = model * skin;
    var out: Varying;
    let world = placed * vec4<f32>(vertex.position, 1.0);
    out.clip = frame.view_projection * world;
    out.world_z = world.z;
    let rows = (instance.base.y + layer.layer_slot) * 2u;
    let top = uv_rows[rows];
    let bottom = uv_rows[rows + 1u];
    out.uv = vec2<f32>(top.x * vertex.uv.x + top.y * vertex.uv.y + top.w, bottom.x * vertex.uv.x + bottom.y * vertex.uv.y + bottom.w);
    let normal = normalize((placed * vec4<f32>(vertex.normal, 0.0)).xyz);
    out.light = frame.light_ambient.xyz + frame.light_key.xyz * max(dot(normal, frame.light_toward.xyz), 0.0);
    if (frame.light_key.w == 0.0 || layer.unshaded != 0u) {
        out.light = vec3<f32>(1.0);
    }
    if (frame.glow.w > 1.0 && layer.unshaded == 0u) {
        let height = max(world.z - frame.glow_at.x, 0.0) / frame.glow.w;
        let near = (1.0 - min(height, 1.0)) * (1.0 - min(height, 1.0));
        let flicker = 0.88 + 0.12 * sin(frame.glow_at.y * 2.7 + world.x * 0.021) * sin(frame.glow_at.y * 1.3 + world.y * 0.017);
        out.light += frame.glow.rgb * near * flicker * (0.55 + 0.45 * max(-normal.z, 0.0));
    }
    let geoset = slot_colors[instance.base.y + layer.geoset_slot];
    let own = slot_colors[instance.base.y + layer.layer_slot];
    out.tint = vec4<f32>(instance.tint.rgb * geoset.rgb * own.rgb, instance.tint.a);
    out.team = instance.team.xyz;
    out.fade = geoset.a * own.a;
    return out;
}

fn linear_light(display: vec3<f32>) -> vec3<f32> {
    return select(pow((display + 0.055) / 1.055, vec3<f32>(2.4)), display / 12.92, display <= vec3<f32>(0.04045));
}

@fragment
fn fragment_main(in: Varying) -> @location(0) vec4<f32> {
    var color = textureSample(layer_texture, layer_sampler, in.uv);
    if (layer.kind == 1u) {
        color = vec4<f32>(in.team, 1.0);
    } else if (layer.kind == 2u) {
        let glow = sin(clamp(1.0 - length(in.uv - vec2<f32>(0.5, 0.5)) * 2.8, 0.0, 1.0));
        if (glow < 0.02) {
            discard;
        }
        color = vec4<f32>(select(in.team, in.team * glow, layer.ignores_texture_alpha == 1u), glow);
    }
    let additive = layer.ignores_texture_alpha == 1u;
    var fog_target = frame.fog_color.rgb;
    if (additive) {
        color = vec4<f32>(color.rgb * in.light * in.tint.rgb * in.tint.a * in.fade, 1.0);
        fog_target = vec3<f32>(0.0);
    } else {
        color = vec4<f32>(color.rgb * in.light * in.tint.rgb, color.a * in.tint.a * in.fade);
    }
    if (in.fade < 0.004 || color.a < layer.cutoff || (frame.camera.w > 0.5 && in.world_z < frame.camera.z)) {
        discard;
    }
    if (frame.fog_color.w > 0.5) {
        let fog = clamp((in.clip.w - frame.fog_range.x) / max(frame.fog_range.y - frame.fog_range.x, 1.0), 0.0, frame.fog_range.z);
        color = vec4<f32>(mix(color.rgb, fog_target, fog), color.a);
    }
    return vec4<f32>(linear_light(color.rgb), color.a);
}
