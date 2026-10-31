struct Layer {
    kind: u32,
    cutoff: f32,
    geoset_slot: u32,
    layer_slot: u32,
    ignores_texture_alpha: u32,
    lighting: u32,
};

const UNLIT = 0u;
const LIT_AND_SHADOWED = 2u;
const WRAP = 0.3;
const RIM = 1.0;
const RIM_EDGE = 2.5;
const MAX_LIGHT = 1.1;
// Replaceable 2 as the player's install draws it: a Gaussian spot measured from the TeamGlow textures, peak 0.46 of the team colour, falling to 1/e at 0.2 of the quad from its centre.
const TEAM_GLOW_PEAK = 0.46;
const TEAM_GLOW_RADIUS = 0.2;

@group(0) @binding(2) var<storage, read> slot_colors: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> uv_rows: array<vec4<f32>>;
@group(0) @binding(4) var shadow_map: texture_depth_2d;
@group(0) @binding(5) var shadow_sampler: sampler_comparison;
@group(1) @binding(0) var layer_texture: texture_2d<f32>;
@group(1) @binding(1) var layer_sampler: sampler;
@group(1) @binding(2) var<uniform> layer: Layer;

struct Varying {
    @builtin(position) clip: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) world: vec3<f32>,
    @location(2) normal: vec3<f32>,
    @location(3) tint: vec4<f32>,
    @location(4) team: vec3<f32>,
    @location(5) fade: f32,
};

fn placement(vertex: Vertex, instance: Instance) -> mat4x4<f32> {
    let model = mat4x4<f32>(instance.model0, instance.model1, instance.model2, instance.model3);
    let skin = bones[instance.base.x + vertex.bones.x] * vertex.weights.x
        + bones[instance.base.x + vertex.bones.y] * vertex.weights.y
        + bones[instance.base.x + vertex.bones.z] * vertex.weights.z
        + bones[instance.base.x + vertex.bones.w] * vertex.weights.w;
    return model * skin;
}

fn animated_uv(vertex: Vertex, instance: Instance) -> vec2<f32> {
    let rows = (instance.base.y + layer.layer_slot) * 2u;
    let top = uv_rows[rows];
    let bottom = uv_rows[rows + 1u];
    return vec2<f32>(top.x * vertex.uv.x + top.y * vertex.uv.y + top.w, bottom.x * vertex.uv.x + bottom.y * vertex.uv.y + bottom.w);
}

fn geoset_of(instance: Instance) -> vec4<f32> {
    return slot_colors[instance.base.y + layer.geoset_slot];
}

fn layer_of(instance: Instance) -> vec4<f32> {
    return slot_colors[instance.base.y + layer.layer_slot];
}

fn tint_of(instance: Instance) -> vec4<f32> {
    return vec4<f32>(instance.tint.rgb * geoset_of(instance).rgb * layer_of(instance).rgb, instance.tint.a);
}

fn fade_of(instance: Instance) -> f32 {
    return geoset_of(instance).a * layer_of(instance).a;
}

@vertex
fn vertex_main(vertex: Vertex, instance: Instance) -> Varying {
    let placed = placement(vertex, instance);
    let world = placed * vec4<f32>(vertex.position, 1.0);
    var out: Varying;
    out.clip = frame.view_projection * world;
    out.uv = animated_uv(vertex, instance);
    out.world = world.xyz;
    out.normal = normalize((placed * vec4<f32>(vertex.normal, 0.0)).xyz);
    out.tint = tint_of(instance);
    out.team = instance.team.xyz;
    out.fade = fade_of(instance);
    return out;
}

@vertex
fn shadow_vertex(vertex: Vertex, instance: Instance) -> Varying {
    var out: Varying;
    out.clip = frame.view_projection * placement(vertex, instance) * vec4<f32>(vertex.position, 1.0);
    out.uv = animated_uv(vertex, instance);
    out.tint = tint_of(instance);
    out.fade = fade_of(instance);
    return out;
}

@fragment
fn shadow_fragment(in: Varying) {
    if (in.fade < 0.004 || textureSample(layer_texture, layer_sampler, in.uv).a * in.tint.a * in.fade < layer.cutoff) {
        discard;
    }
}

fn sun_visibility(world: vec3<f32>, normal: vec3<f32>, facing: f32) -> f32 {
    let shifted = world + normal * frame.shadow.y * (1.0 - 0.5 * clamp(facing, 0.0, 1.0));
    let at = frame.sun_projection * vec4<f32>(shifted, 1.0);
    let uv = vec2<f32>(at.x * 0.5 + 0.5, 0.5 - at.y * 0.5);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || at.z > 1.0) {
        return 1.0;
    }
    let texel = frame.shadow.x;
    var lit = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            lit += textureSampleCompareLevel(shadow_map, shadow_sampler, uv + vec2<f32>(f32(dx), f32(dy)) * texel, at.z);
        }
    }
    return lit / 9.0;
}

fn light_of(in: Varying) -> vec3<f32> {
    let toward = frame.light_toward.xyz;
    let view = normalize(frame.eye.xyz - in.world);
    var normal = normalize(in.normal);
    if (dot(normal, view) < 0.0) {
        normal = -normal;
    }
    let facing = dot(normal, toward);
    let diffuse = clamp((facing + WRAP) / (1.0 + WRAP), 0.0, 1.0);
    var visibility = 1.0;
    if (layer.lighting == LIT_AND_SHADOWED && frame.shadow.z > 0.5) {
        visibility = sun_visibility(in.world, normal, facing);
    }
    let sky = 0.85 + 0.3 * (normal.z * 0.5 + 0.5);
    var light = min(frame.light_ambient.xyz * sky + frame.light_key.xyz * diffuse * visibility, vec3<f32>(MAX_LIGHT));
    if (layer.lighting == LIT_AND_SHADOWED) {
        let tint = frame.light_ambient.xyz + frame.light_key.xyz * 0.5;
        let rim = pow(1.0 - clamp(dot(normal, view), 0.0, 1.0), RIM_EDGE);
        light += rim * RIM * tint / max(max(tint.r, tint.g), max(tint.b, 0.001));
    }
    return light;
}

fn lava_glow(in: Varying) -> vec3<f32> {
    let height = max(in.world.z - frame.glow_at.x, 0.0) / frame.glow.w;
    let near = (1.0 - min(height, 1.0)) * (1.0 - min(height, 1.0));
    let flicker = 0.88 + 0.12 * sin(frame.glow_at.y * 2.7 + in.world.x * 0.021) * sin(frame.glow_at.y * 1.3 + in.world.y * 0.017);
    return frame.glow.rgb * near * flicker * (0.55 + 0.45 * max(-normalize(in.normal).z, 0.0));
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
        let from_centre = length(in.uv - vec2<f32>(0.5, 0.5));
        let glow = TEAM_GLOW_PEAK * exp(-from_centre * from_centre / (TEAM_GLOW_RADIUS * TEAM_GLOW_RADIUS));
        if (glow < 0.005) {
            discard;
        }
        color = vec4<f32>(select(in.team, in.team * glow, layer.ignores_texture_alpha == 1u), glow);
    }
    let additive = layer.ignores_texture_alpha == 1u;
    var light = vec3<f32>(1.0);
    if (layer.lighting != UNLIT && frame.light_key.w > 0.5) {
        light = light_of(in);
    }
    if (layer.lighting != UNLIT && frame.glow.w > 1.0) {
        light += lava_glow(in);
    }
    var fog_target = frame.fog_color.rgb;
    if (additive) {
        color = vec4<f32>(color.rgb * in.tint.rgb * in.tint.a * in.fade, 1.0);
        fog_target = vec3<f32>(0.0);
    } else {
        color = vec4<f32>(color.rgb * light * in.tint.rgb, color.a * in.tint.a * in.fade);
    }
    if (in.fade < 0.004 || (frame.camera.w > 0.5 && in.world.z < frame.camera.z)) {
        discard;
    }
    if (layer.cutoff > 0.0) {
        color.a = clamp((color.a - layer.cutoff) / max(fwidth(color.a), 0.0001) + 0.5, 0.0, 1.0);
        if (color.a <= 0.0) {
            discard;
        }
    }
    if (frame.fog_color.w > 0.5) {
        let fog = clamp((in.clip.w - frame.fog_range.x) / max(frame.fog_range.y - frame.fog_range.x, 1.0), 0.0, frame.fog_range.z);
        color = vec4<f32>(mix(color.rgb, fog_target, fog), color.a);
    }
    return vec4<f32>(linear_light(color.rgb), color.a);
}
