@group(0) @binding(1) var clouds: texture_2d<f32>;
@group(0) @binding(2) var cloud_sampler: sampler;

fn stars(ray: vec3<f32>) -> f32 {
    let uv = vec2<f32>(ray.x, ray.z) / (ray.y * 0.5 + 0.6) * 70.0;
    let cell = floor(uv);
    let chance = hash(cell + 3.3);
    if (chance < 0.93) {
        return 0.0;
    }
    let local = fract(uv) - 0.5;
    let jitter = vec2<f32>(hash(cell), hash(cell + 7.7)) - 0.5;
    let twinkle = 0.75 + 0.25 * sin(p.misc.x * (1.5 + chance * 30.0) + chance * 400.0);
    return smoothstep(0.07, 0.0, length(local - jitter * 0.6)) * (0.35 + 0.65 * fract(chance * 97.0)) * twinkle;
}

fn sky_color(ray: vec3<f32>, at: vec2<f32>) -> vec3<f32> {
    let height = ray.z;
    let haze = p.horizon.rgb;
    var color = mix(haze, p.zenith.rgb, pow(clamp(height, 0.0, 1.0), 0.5));
    color = mix(color, p.ground.rgb, smoothstep(0.0, -0.25, height));
    let toward = max(dot(ray, p.sun_toward.xyz), 0.0) * p.sun_toward.w;
    let sun = p.sun_color.rgb;
    color += sun * (pow(toward, 6.0) * 0.03 + pow(toward, 48.0) * 0.1 + pow(toward, 400.0) * 0.4);
    color += sun * 2.5 * smoothstep(0.9996, 0.99992, toward);
    let glow = p.cloud.z;
    if (glow > 0.0) {
        let sideways = max(dot(normalize(ray.xy + vec2<f32>(1e-5, 0.0)), normalize(p.sun_toward.xy + vec2<f32>(1e-5, 0.0))), 0.0);
        let band = exp(-pow((height - 0.02) / 0.11, 2.0));
        color += sun * glow * band * (0.3 + 0.7 * sideways * sideways) * 0.3;
    }
    if (p.cloud.y > 0.0 && height > 0.0) {
        let along = height * 0.8 + ray.x * 0.5 - 0.25;
        let milky = exp(-along * along * 12.0) * (0.55 + 0.45 * sin(ray.x * 23.0 + height * 17.0));
        let night = p.cloud.y * smoothstep(0.03, 0.3, height) * (1.0 - clamp(luminance(haze) * 12.0, 0.0, 0.8));
        color += (vec3<f32>(1.0, 0.95, 0.85) * stars(ray) * 0.9 + vec3<f32>(0.5, 0.55, 0.8) * milky * 0.035) * night;
    }
    return color + (hash(at) - 0.5) * 0.0015;
}

@fragment
fn sky_main(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let ndc = picture_ndc(at.xy);
    var color = sky_color(view_ray(ndc), at.xy);
    if (p.cloud.w > 0.0) {
        let cloud = textureSampleLevel(clouds, cloud_sampler, at.xy / (vec2<f32>(textureDimensions(clouds)) * CLOUD_SCALE), 0.0);
        color = color * (1.0 - cloud.a) + cloud.rgb;
    }
    return vec4<f32>(color, 1.0);
}
