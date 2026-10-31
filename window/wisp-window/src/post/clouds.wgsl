/// How far the layer's wall stands in front of the eye: the nearer the wall, the more the layer slides across the picture as the camera pans.
fn wall(layer: u32) -> f32 {
    return select(select(3500.0, 7000.0, layer == 1u), 15000.0, layer == 2u);
}

/// The size in world units of one cell of the layer's noise.
fn cell(layer: u32) -> f32 {
    return select(select(850.0, 1250.0, layer == 1u), 2000.0, layer == 2u);
}

/// Where the ray meets the layer's wall, in the layer's noise space. Each layer is a vertical cylinder fixed in the world, so a puff keeps its shape on screen and the camera's pan carries the near layers further than the far ones.
fn plane_point(ray: vec3<f32>, layer: u32) -> vec2<f32> {
    let lateral = normalize(p.right.xy + vec2<f32>(1e-5, 0.0));
    let ahead = normalize(p.forward.xy + vec2<f32>(1e-5, 0.0));
    let depth = max(dot(ray.xy, ahead), 0.05);
    let at = vec2<f32>(dot(p.eye.xy, lateral) + wall(layer) * dot(ray.xy, lateral) / depth, p.eye.z + wall(layer) * ray.z / depth);
    let wind = p.misc.x * 0.012 * (1.0 + 0.6 * f32(layer));
    return vec2<f32>(at.x, at.y * 1.7) / cell(layer) + vec2<f32>(wind, 0.0) + vec2<f32>(f32(layer) * 31.7, f32(layer) * 11.3);
}

/// How far the warp bends the grain: the bend is what turns noise into the broad, brushed lobes of a painted cumulus.
fn warp_of(q: vec2<f32>) -> vec2<f32> {
    return (vec2<f32>(noise(q * 0.8 + vec2<f32>(3.1, 7.4)), noise(q * 0.8 + vec2<f32>(11.7, 2.9))) - 0.5) * 0.9;
}

fn billow(at: vec2<f32>, octaves: i32) -> f32 {
    var spot = at;
    var sum = 0.0;
    var weight = 0.55;
    for (var octave = 0; octave < octaves; octave++) {
        sum += noise(spot) * weight;
        spot = spot * 2.1 + vec2<f32>(5.2, 1.3);
        weight *= 0.48;
    }
    return sum;
}

fn edge_of(layer: u32) -> f32 {
    let cover = p.cloud.x * select(select(1.0, 0.85, layer == 1u), 0.7, layer == 2u);
    return mix(0.8, 0.4, clamp(cover, 0.0, 1.0));
}

fn body_of(density: f32, layer: u32) -> f32 {
    let edge = edge_of(layer);
    return smoothstep(edge, edge + 0.16, density);
}

fn sun_in_plane() -> vec2<f32> {
    let sun = p.sun_toward.xyz;
    let lateral = normalize(p.right.xy + vec2<f32>(1e-5, 0.0));
    return normalize(vec2<f32>(dot(sun.xy, lateral), max(sun.z, 0.12) * 1.7) + vec2<f32>(0.0001, 0.0));
}

/// One layer over the ray: lit tops toward the sun, shaded bellies away from it, premultiplied by the body's opacity.
fn layer_light(ray: vec3<f32>, layer: u32, octaves: i32) -> vec4<f32> {
    let q = plane_point(ray, layer);
    let warp = warp_of(q);
    let density = billow(q + warp, octaves);
    let body = body_of(density, layer);
    if (body <= 0.002) {
        return vec4<f32>(0.0);
    }
    let toward = billow(q + warp + sun_in_plane() * 0.3, 3);
    let lit = clamp(0.45 + (density - toward) * 4.2, 0.0, 1.0);
    let haze = p.horizon.rgb;
    let sun = p.sun_color.rgb;
    let sun_tint = sun / max(max(sun.r, sun.g), max(sun.b, 1e-4));
    let height = smoothstep(0.0, 0.3, ray.z);
    let far = select(select(0.0, 0.2, layer == 1u), 0.4, layer == 2u);
    let top = haze * 1.9 + sun * 0.06 + sun_tint * 0.012;
    let belly = mix(p.zenith.rgb, haze, 0.2) * 0.7;
    var colour = mix(belly, top, lit * lit * (3.0 - 2.0 * lit));
    colour += sun * 0.1 * pow(lit, 3.0) * (0.25 + 0.75 * pow(max(dot(ray, p.sun_toward.xyz), 0.0), 6.0)) * p.sun_toward.w;
    colour = mix(colour, haze, far);
    colour = mix(haze, colour, height);
    let alpha = body * (0.9 - far * 0.5) * smoothstep(0.01, 0.17, ray.z);
    return vec4<f32>(colour * alpha, alpha);
}

fn sun_ndc() -> vec3<f32> {
    let sun = p.sun_toward.xyz;
    let ahead = dot(sun, p.forward.xyz);
    let at = vec2<f32>(dot(sun, p.right.xyz) / p.lens.x, dot(sun, p.up.xyz) / p.lens.y + p.lens.z) / max(ahead, 1e-3);
    return vec3<f32>(at, select(0.0, 1.0, ahead > 0.05));
}

/// Sun shafts: light the nearest layer lets through between the pixel and the sun, marched in a few steps toward the sun's place on the picture.
fn shafts(ndc: vec2<f32>) -> f32 {
    let sun = sun_ndc();
    if (sun.z < 0.5 || p.sun_toward.w < 0.5) {
        return 0.0;
    }
    let steps = 5;
    let step_ndc = (sun.xy - ndc) / f32(steps);
    var seen = 0.0;
    var decay = 1.0;
    for (var step = 1; step <= steps; step++) {
        let along = ndc + step_ndc * (f32(step) - 0.5);
        let ray = view_ray(along);
        let open = 1.0 - body_of(billow(plane_point(ray, 0u), 2), 0u);
        seen += open * decay * smoothstep(0.0, 0.12, ray.z);
        decay *= 0.85;
    }
    let reach = length((sun.xy - ndc) * vec2<f32>(p.lens.w, 1.0));
    return seen / f32(steps) * exp(-reach * 1.4);
}

@fragment
fn cloud_main(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let ndc = picture_ndc(at.xy * CLOUD_SCALE);
    let ray = view_ray(ndc);
    let layers = u32(p.cloud.w);
    var cloud = vec4<f32>(0.0);
    if (ray.z > 0.0) {
        for (var index = 0u; index < layers; index++) {
            let layer = layers - 1u - index;
            let one = layer_light(ray, layer, select(4, 3, layer > 0u));
            cloud = one + cloud * (1.0 - one.a);
        }
    }
    if (layers >= 3u) {
        let sun = p.sun_color.rgb;
        cloud = vec4<f32>(cloud.rgb + sun * shafts(ndc) * 0.4 * (1.0 - cloud.a), cloud.a);
    }
    return cloud;
}
