fn hash(cell: vec2<f32>) -> f32 {
    return fract(sin(dot(cell, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn noise(at: vec2<f32>) -> f32 {
    let cell = floor(at);
    let f = fract(at);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2<f32>(1.0, 0.0)), u.x), mix(hash(cell + vec2<f32>(0.0, 1.0)), hash(cell + vec2<f32>(1.0, 1.0)), u.x), u.y);
}

fn clouds(at: vec2<f32>) -> f32 {
    var sum = 0.0;
    var weight = 0.5;
    var scale = at;
    for (var octave = 0; octave < 5; octave++) {
        sum += noise(scale) * weight;
        scale = scale * 2.03 + vec2<f32>(17.0, 9.0);
        weight *= 0.5;
    }
    return sum;
}

fn sky_color(ray: vec3<f32>) -> vec3<f32> {
    let height = ray.z;
    var color = mix(p.horizon.rgb, p.zenith.rgb, pow(clamp(height, 0.0, 1.0), 0.5));
    color = mix(color, p.ground.rgb, smoothstep(0.0, -0.25, height));
    let toward = max(dot(ray, p.sun_toward.xyz), 0.0) * p.sun_toward.w;
    let sun = p.sun_color.rgb;
    color += sun * (pow(toward, 6.0) * 0.06 + pow(toward, 48.0) * 0.18);
    color += sun * 6.0 * smoothstep(0.99955, 0.99985, toward);
    if (height > 0.0) {
        let plane = ray.xy / (height + 0.18);
        let drift = plane * 0.55 + vec2<f32>(p.misc.x * 0.012, p.misc.x * 0.004);
        let density = clouds(drift);
        let shade = clouds(drift + p.sun_toward.xy * 0.12);
        let cover = smoothstep(0.46, 0.74, density) * smoothstep(0.0, 0.2, height);
        let lit = clamp(0.55 + (density - shade) * 3.0, 0.0, 1.0);
        let body = mix(p.horizon.rgb * 0.8 + p.zenith.rgb * 0.3, mix(p.horizon.rgb, vec3<f32>(1.0), 0.55) * (0.55 + 0.9 * luminance(sun)), lit);
        color = mix(color, body, cover * 0.8);
    }
    return color;
}

@fragment
fn sky_main(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let direction = view_direction(picture_ndc(at.xy));
    let ray = normalize(p.right.xyz * direction.x + p.up.xyz * direction.y + p.forward.xyz * -direction.z);
    return vec4<f32>(sky_color(ray), 1.0);
}
