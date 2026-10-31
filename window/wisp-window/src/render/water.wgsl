struct Water {
    shallow: vec4<f32>,
    deep: vec4<f32>,
    foam: vec4<f32>,
    flow: vec4<f32>,
    shine: vec4<f32>,
    wave: vec4<f32>,
    glow: vec4<f32>,
    look: vec4<f32>,
    sparks: vec4<f32>,
    ripples: array<vec4<f32>, 32>,
};

@group(1) @binding(0) var frames: texture_2d_array<f32>;
@group(1) @binding(1) var tiled: sampler;
@group(1) @binding(2) var refracted: texture_2d<f32>;
@group(1) @binding(3) var reflected: texture_2d<f32>;
@group(1) @binding(4) var depth: texture_depth_multisampled_2d;
@group(1) @binding(5) var clamped: sampler;
@group(1) @binding(6) var<uniform> water: Water;

struct Surface {
    @builtin(position) clip: vec4<f32>,
    @location(0) world: vec3<f32>,
};

@vertex
fn vertex_main(vertex: Vertex, instance: Instance) -> Surface {
    let model = mat4x4<f32>(instance.model0, instance.model1, instance.model2, instance.model3);
    let world = model * vec4<f32>(vertex.position, 1.0);
    var out: Surface;
    out.clip = frame.view_projection * world;
    out.world = world.xyz;
    return out;
}

fn linear_depth(raw: f32) -> f32 {
    let near = frame.camera.x;
    let far = frame.camera.y;
    return near * far / (far - raw * (far - near));
}

fn scene_depth(pixel: vec2<i32>) -> f32 {
    let size = vec2<i32>(textureDimensions(depth));
    return linear_depth(textureLoad(depth, clamp(pixel, vec2<i32>(0), size - vec2<i32>(1)), 0));
}

fn frame_height(uv: vec2<f32>, time: f32) -> f32 {
    let count = f32(textureNumLayers(frames));
    let position = time * water.flow.z;
    let first = i32(floor(position)) % i32(count);
    let second = (first + 1) % i32(count);
    let blend = fract(position);
    let a = textureSampleLevel(frames, tiled, uv, first, 0.0).rgb;
    let b = textureSampleLevel(frames, tiled, uv, second, 0.0).rgb;
    return dot(mix(a, b, blend), vec3<f32>(0.3, 0.5, 0.2));
}

// The frame's height change per texel, taken over a window that widens with distance so far water softens instead of crawling.
fn slope(uv: vec2<f32>, time: f32, step: f32, spread: f32) -> vec2<f32> {
    let per_texel = 1.0 / f32(textureDimensions(frames).x);
    let reach = max(step, 1.25 * per_texel) * spread;
    let centre = frame_height(uv, time);
    return vec2<f32>(frame_height(uv + vec2<f32>(reach, 0.0), time) - centre, frame_height(uv + vec2<f32>(0.0, reach), time) - centre) / reach * per_texel;
}

fn reorient(a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {
    return normalize(vec3<f32>(a.xy + b.xy, a.z * b.z));
}

fn gerstner(position: vec2<f32>, time: f32) -> vec2<f32> {
    var gradient = vec2<f32>(0.0);
    for (var wave = 0; wave < 3; wave++) {
        let w = f32(wave);
        let direction = normalize(vec2<f32>(cos(0.9 + w * 1.7), sin(0.9 + w * 1.7)));
        let k = water.wave.y * (1.0 + w * 0.9);
        let amplitude = water.wave.x / (1.0 + w * 1.4);
        let phase = k * dot(direction, position) - time * sqrt(9.8 * k) * water.wave.z;
        gradient += direction * (amplitude * k * cos(phase));
    }
    return gradient;
}

fn hash(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn noise(p: vec2<f32>) -> f32 {
    let cell = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2<f32>(1.0, 0.0)), u.x), mix(hash(cell + vec2<f32>(0.0, 1.0)), hash(cell + vec2<f32>(1.0, 1.0)), u.x), u.y);
}

fn fbm(p: vec2<f32>) -> f32 {
    var sum = 0.0;
    var amplitude = 0.5;
    var q = p;
    for (var octave = 0; octave < 4; octave++) {
        sum += amplitude * noise(q);
        q = q * 2.03 + vec2<f32>(17.1, 9.3);
        amplitude *= 0.5;
    }
    return sum;
}

// A molten surface as one drifting field with no cell edges: x is the field that cooled crust takes where it runs high, y how hot the melt is, z a fine grain for the crust.
fn lava_field(p: vec2<f32>, time: f32) -> vec3<f32> {
    let warp = vec2<f32>(fbm(p * 0.0031 + vec2<f32>(5.0, time * 0.004)), fbm(p * 0.0031 + vec2<f32>(21.0, -time * 0.003))) - 0.47;
    let crust = fbm((p + vec2<f32>(time * 2.6, time * 1.1) + warp * 360.0) * 0.0038);
    let heat = fbm((p - vec2<f32>(time * 5.0, -time * 2.0) + warp * 200.0) * 0.0085 + 40.0);
    let grain = fbm(p * 0.03 + warp * 4.0);
    return vec3<f32>(crust, heat, grain);
}

// Bubbles that swell, then pop with a flash, on a jittered grid; x is the rim of a live bubble, y the flash of a popping one.
fn bubbles(p: vec2<f32>, time: f32, density: f32) -> vec2<f32> {
    let size = 70.0;
    let cell = floor(p / size);
    var rim = 0.0;
    var flash = 0.0;
    for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
            let c = cell + vec2<f32>(f32(ox), f32(oy));
            let h = hash(c);
            if (h > density) {
                continue;
            }
            let h2 = hash(c + vec2<f32>(17.3, 5.1));
            let h3 = hash(c + vec2<f32>(41.9, 23.7));
            let life = fract(time * (0.07 + 0.1 * h2) + h3);
            let centre = (c + vec2<f32>(0.2 + 0.6 * h2, 0.2 + 0.6 * h3)) * size;
            let radius = (4.0 + 10.0 * h2) * sqrt(life);
            let d = length(p - centre);
            rim += smoothstep(2.2, 0.0, abs(d - radius)) * (1.0 - life * 0.5);
            flash += smoothstep(0.84, 0.9, life) * (1.0 - smoothstep(0.9, 1.0, life)) * smoothstep(radius * 1.6, 0.0, d);
        }
    }
    return vec2<f32>(min(rim, 1.0), min(flash, 1.0));
}

// Embers lifting off the surface: small flickering points that drift sideways as they fade.
fn embers(p: vec2<f32>, time: f32, density: f32) -> f32 {
    let size = 46.0;
    let cell = floor(p / size);
    var glow = 0.0;
    for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
            let c = cell + vec2<f32>(f32(ox), f32(oy));
            let h = hash(c + vec2<f32>(3.7, 9.2));
            if (h > density) {
                continue;
            }
            let h2 = hash(c + vec2<f32>(61.1, 2.3));
            let h3 = hash(c + vec2<f32>(7.9, 37.3));
            let life = fract(time * (0.12 + 0.2 * h2) + h3);
            let drift = vec2<f32>(sin(time * h2 * 2.0 + h3 * 6.28) * 7.0 + life * 16.0, life * 10.0);
            let centre = (c + vec2<f32>(0.15 + 0.7 * h2, 0.15 + 0.7 * h3)) * size + drift;
            let flicker = 0.55 + 0.45 * sin(time * (5.0 + 7.0 * h3) + h * 40.0);
            glow += smoothstep(1.7, 0.0, length(p - centre)) * flicker * sin(life * 3.1416);
        }
    }
    return min(glow, 1.0);
}

// Long low swells stretched along the stage and drifting both ways, whose strength wanders with a slow noise so the crests never repeat: the gradient of four skewed sines, so the surface streaks and rolls instead of shimmering as grain.
fn swell(p: vec2<f32>, time: f32) -> vec2<f32> {
    var gradient = vec2<f32>(0.0);
    for (var layer = 0; layer < 4; layer++) {
        let w = f32(layer);
        let k = vec2<f32>(0.0026 + 0.0011 * w, 0.0105 + 0.0045 * w) * select(vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0), (layer & 1) == 1);
        let phase = dot(k, p) + w * 2.1 - time * (0.35 + 0.18 * w);
        gradient += k * (cos(phase) * 21.0 / (1.0 + w * 0.8));
    }
    return gradient * (0.55 + 0.9 * noise(p * 0.0011 + vec2<f32>(time * 0.02, 4.0)));
}

// Thin bright lines where two drifting noise fields, warped by slow waves, cross their middle: caustic light gathered into a moving web, widening with distance so it never aliases.
fn web(p: vec2<f32>, time: f32, spread: f32) -> f32 {
    let q = p * 0.0085;
    let warped = q + vec2<f32>(sin(q.y * 2.3 + time * 0.5), sin(q.x * 2.7 - time * 0.4)) * 0.55;
    let a = abs(noise(warped + vec2<f32>(time * 0.07, 0.0)) - 0.5);
    let b = abs(noise(warped * 1.9 + vec2<f32>(9.0, -time * 0.09)) - 0.5);
    let wide = min(spread, 3.0);
    return (1.0 - smoothstep(0.0, 0.06 * wide, min(a, b))) / wide;
}

// Poison's inner light: spiral arms around slowly wandering whirlpool centres over drifting ridged veins. x is the veins, y the arms.
fn swirl(p: vec2<f32>, time: f32) -> vec2<f32> {
    let q = p * 0.005;
    let turn = noise(q * 0.6 + vec2<f32>(time * 0.02, 3.0)) * 12.5;
    let warped = q + vec2<f32>(cos(turn), sin(turn)) * 0.8;
    let vein = pow(1.0 - abs(2.0 * noise(warped * 2.0 - vec2<f32>(0.0, time * 0.07)) - 1.0), 4.0);
    let size = 760.0;
    let cell = floor(p / size);
    var arms = 0.0;
    let toward = step(vec2<f32>(0.5), fract(p / size)) * 2.0 - 1.0;
    for (var oy = 0; oy <= 1; oy++) {
        for (var ox = 0; ox <= 1; ox++) {
            let c = cell + vec2<f32>(f32(ox), f32(oy)) * toward;
            let h = hash(c + vec2<f32>(2.1, 8.4));
            let h2 = hash(c + vec2<f32>(15.3, 1.9));
            let centre = (c + vec2<f32>(0.2 + 0.6 * h, 0.2 + 0.6 * h2) + vec2<f32>(sin(time * 0.05 + h * 6.28), cos(time * 0.04 + h2 * 6.28)) * 0.08) * size;
            let offset = p - centre;
            let r = length(offset);
            let spin = select(1.0, -1.0, h2 > 0.5);
            let angle = atan2(offset.y, offset.x) * (2.0 + floor(h * 2.0)) + spin * (r * 0.018 - time * 0.55);
            let reach = 150.0 + 140.0 * h2;
            arms += (0.5 + 0.5 * sin(angle)) * smoothstep(reach, reach * 0.15, r) * smoothstep(2.0, 40.0, r);
        }
    }
    return vec2<f32>(vein, min(arms, 1.0));
}

// One ring of height across x in -1..1, and its slope in x: a crest and a trough under a smooth window.
fn ring(x: f32) -> vec2<f32> {
    let inside = 1.0 - x * x;
    let window = inside * inside;
    let a = 6.2832 * x;
    return vec2<f32>(sin(a) * window, 6.2832 * cos(a) * window - 4.0 * x * inside * sin(a));
}

// What bodies in the water do to the surface: x and y are the slope they add, z the foam. Bodies at rest send rings outward and drag a wake when they move;
// a body that enters or leaves sends a burst of rings with a crown of foam that fades. Sources come from the renderer (ripples.rs).
fn disturbance(p: vec2<f32>, time: f32) -> vec3<f32> {
    var slope = vec2<f32>(0.0);
    var foam = 0.0;
    let count = i32(water.sparks.w);
    for (var i = 0; i < count; i++) {
        let at = water.ripples[2 * i];
        let motion = water.ripples[2 * i + 1];
        let offset = p - at.xy;
        let d = length(offset);
        let outward = offset / max(d, 0.001);
        let r = at.z;
        if (motion.w < 0.5) {
            let speed = length(motion.xy);
            let reach = r * 2.6 + 90.0;
            if (d > r * 0.6 && d < r + reach) {
                for (var k = 0; k < 3; k++) {
                    let phase = fract(time * 0.33 + f32(k) / 3.0 + at.x * 0.0071);
                    let width = 12.0 + phase * 34.0;
                    let x = (d - (r * 1.02 + phase * reach)) / width;
                    if (abs(x) < 1.0) {
                        let amp = pow(1.0 - phase, 1.6) * smoothstep(0.0, 0.1, phase) * (0.6 + min(speed / 300.0, 0.8));
                        let h = ring(x);
                        slope += outward * (h.y / width * 1.4 * amp);
                        foam += max(h.x, 0.0) * amp * 0.5;
                    }
                }
                let collar = smoothstep(r * 1.5, r * 1.0, d) * smoothstep(r * 0.6, r * 0.95, d);
                foam += collar * 0.3 * (0.6 + 0.4 * noise(p * 0.05 + time * 0.4));
            }
            let length_of_wake = 160.0 + speed * 1.2;
            if (speed > 35.0) {
                let behind = -motion.xy / speed;
                let along = dot(offset, behind);
                if (along > 0.0 && along < length_of_wake) {
                    let across = abs(dot(offset, vec2<f32>(-behind.y, behind.x)));
                    let arm = 1.0 - smoothstep(0.0, 16.0 + along * 0.08, abs(across - (r * 0.8 + along * 0.3)));
                    let fade = pow(1.0 - along / length_of_wake, 1.5) * smoothstep(35.0, 250.0, speed);
                    foam += arm * fade * (0.5 + 0.5 * noise(offset * 0.08 - time * 0.5)) * 1.1;
                    slope += outward * (arm * fade * 0.12 * sin(along * 0.15 - time * 5.0));
                }
            }
        } else {
            let age = time - at.w;
            let strength = motion.z;
            if (age >= 0.0 && age < 1.9) {
                let fade = pow(1.0 - age / 1.9, 1.8);
                for (var k = 0; k < 3; k++) {
                    let a = age - f32(k) * 0.13;
                    if (a >= 0.0) {
                        let front = r * 1.1 + a * (300.0 + 120.0 * strength) / (1.0 + a * 0.6);
                        let width = 16.0 + a * 52.0;
                        let x = (d - front) / width;
                        if (abs(x) < 1.0) {
                            let amp = strength * fade * (1.0 - f32(k) * 0.25);
                            let h = ring(x);
                            slope += outward * (h.y / width * 1.4 * 1.6 * amp);
                            foam += max(h.x, 0.0) * amp * 0.45;
                        }
                    }
                }
                let crown = r * 1.25 + age * 110.0;
                let spray = (1.0 - smoothstep(crown * 0.7, crown, d)) * (1.0 - smoothstep(0.0, 0.75, age)) * strength * step(r * 0.5, d);
                foam += spray * (0.35 + 0.65 * noise(offset * 0.11 + age * 3.0)) * 0.8;
            }
        }
    }
    return vec3<f32>(slope, min(foam, 0.7));
}

@fragment
fn fragment_main(in: Surface) -> @location(0) vec4<f32> {
    let time = water.flow.w;
    let tile = water.flow.x;
    let pixel = in.clip.xy;
    let screen = pixel * frame.screen.zw;
    let view = normalize(frame.eye.xyz - in.world);
    let own = in.clip.w;
    let thickness = max(scene_depth(vec2<i32>(pixel)) - own, 0.0);
    let calm = smoothstep(0.0, water.foam.w * 2.0, thickness);

    let uv = in.world.xy / tile;
    let spread = clamp(own / 1800.0, 1.0, 24.0);
    let near = 1.0 / spread;
    let fine = slope(uv * 1.0 + vec2<f32>(time * 0.011, time * 0.006), time, 0.004, spread);
    let coarse = slope(uv * 0.37 - vec2<f32>(time * 0.007, -time * 0.004), time * 0.7, 0.01, spread);
    let broad = gerstner(in.world.xy, time) + swell(in.world.xy, time) * water.sparks.z * (1.0 - 0.9 * smoothstep(1800.0, 6000.0, own));
    let disturbed = disturbance(in.world.xy, time);
    let strength = water.flow.y * 3.0 * calm * near;
    let n1 = normalize(vec3<f32>(-fine * strength, 1.0));
    let n2 = normalize(vec3<f32>(-coarse * strength, 1.0));
    let n3 = normalize(vec3<f32>(-(broad * calm + disturbed.xy * min(near * 1.5, 1.0)), 1.0));
    let normal = reorient(reorient(n1, n2), n3);

    let facing = clamp(dot(normal, view), 0.0, 1.0);
    let fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);

    let heat = water.look.y;
    let wobble = heat * 0.012 * vec2<f32>(sin(pixel.y * 0.045 + time * 3.1 + noise(in.world.xy * 0.03) * 6.0), cos(pixel.x * 0.035 - time * 2.3 + noise(in.world.xy * 0.02 + 9.0) * 6.0));
    var push = normal.xy * water.shine.w;
    var look = screen + vec2<f32>(push.x, -push.y) * min(thickness * 0.02 + 0.3, 1.0) + wobble;
    let looked = scene_depth(vec2<i32>(look * frame.screen.xy));
    if (looked < own) {
        look = screen;
    }
    let beneath = max(scene_depth(vec2<i32>(look * frame.screen.xy)) - own, 0.0);
    let bed = textureSampleLevel(refracted, clamped, look, 0.0).rgb;
    let absorb = max(1.0 - exp(-beneath * water.shallow.w), water.look.z);
    let ramp = max(1.0 - exp(-beneath * water.deep.w), 0.85 * (1.0 - exp(-max(own - 900.0, 0.0) * 0.00055)));
    let body = mix(water.shallow.rgb, water.deep.rgb, ramp);
    let glow = min(frame_height(uv * 1.7 + vec2<f32>(0.3, time * 0.01), time), frame_height(uv * 1.3 - vec2<f32>(time * 0.013, 0.1), time * 1.3));
    let caustic = pow(clamp(glow * 1.6, 0.0, 1.0), 3.0) * (1.0 - absorb) * water.shine.z;
    var colour = mix(bed + caustic * vec3<f32>(0.5, 0.9, 1.0), body, absorb);
    let lines = web(in.world.xy, time, spread) * calm * water.shine.z * (1.0 - 0.45 * ramp);
    colour += mix(vec3<f32>(0.55, 0.95, 1.0), water.glow.rgb * 1.5, step(0.0001, water.glow.w)) * lines * 0.55;

    var plate = 0.0;
    var rim = 0.0;
    var melt = 1.0;
    if (water.look.x > 0.0) {
        let field = lava_field(in.world.xy, time);
        let hazed = clamp((own - 2500.0) / 5000.0, 0.0, 1.0);
        let level = 0.68 - 0.4 * water.look.x;
        let soft = max(fwidth(field.x) * 1.5, 0.012);
        let edge = smoothstep(level - soft, level + soft, field.x);
        let reach = max(fwidth(field.x) * 2.5, 0.05);
        plate = mix(edge, water.look.x * 0.8, hazed);
        rim = edge * (1.0 - smoothstep(0.0, reach, field.x - level)) * (1.0 - hazed);
        let seam = pow(1.0 - abs(2.0 * field.z - 1.0), 6.0) * edge * (1.0 - hazed) * 0.6;
        melt = mix(0.55 + 0.9 * smoothstep(0.25, 0.7, field.y), 1.0, hazed);
        let toward = select(0.5, max(dot(normal, frame.light_toward.xyz), 0.0), frame.light_key.w > 0.5);
        let cooled = vec3<f32>(0.075, 0.018, 0.008) * (0.6 + 0.9 * toward) * (0.55 + 0.9 * field.z);
        colour = mix(colour, cooled, plate);
        rim += seam;
    }
    if (water.glow.w > 0.0) {
        let pulse = 0.85 + 0.15 * sin(time * 0.8 + noise(in.world.xy * 0.02) * 6.28);
        let source = (0.35 + 0.65 * ramp) * (1.0 - plate) * pulse * melt * (1.0 - 0.55 * step(0.0001, water.sparks.y));
        colour += water.glow.rgb * water.glow.w * (source + rim * 1.6);
        colour += water.foam.rgb * max(melt - 1.0, 0.0) * (1.0 - plate) * 0.5;
    }
    if (water.sparks.y > 0.0) {
        let lit = swirl(in.world.xy, time);
        colour += water.glow.rgb * water.sparks.y * (lit.x * 0.55 + lit.y * 1.1) * (0.4 + 0.6 * ramp) * (1.0 - 0.6 * smoothstep(4000.0, 9000.0, own));
    }
    let mirror = screen + vec2<f32>(normal.x, -normal.y) * 0.5 * water.shine.w + wobble * 2.5;
    let sky = textureSampleLevel(reflected, clamped, clamp(mirror, vec2<f32>(0.002), vec2<f32>(0.998)), 0.0).rgb;
    colour = mix(colour, sky, clamp(fresnel * water.wave.w * (1.0 - 0.85 * plate), 0.0, 1.0));

    let lit_scene = frame.light_key.w > 0.5;
    let sun = select(normalize(vec3<f32>(0.2, 0.55, 0.8)), frame.light_toward.xyz, lit_scene);
    let sun_colour = select(vec3<f32>(1.0, 0.95, 0.85), frame.light_key.rgb, lit_scene);
    {
        let half = normalize(sun + view);
        let glints = mix(0.7, 0.45 + 0.55 * (noise(in.world.xy * 0.4 + time * 0.8) * noise(in.world.xy * 1.1 - time * 0.5) * 2.2), near);
        colour += sun_colour * pow(max(dot(normal, half), 0.0), water.shine.x) * water.shine.y * glints * (1.0 - 0.9 * plate);
    }

    if (water.look.w > 0.0) {
        let pop = bubbles(in.world.xy, time, water.look.w * 0.5);
        colour += water.foam.rgb * (pop.x * 0.5 + pop.y * 1.4) * (1.0 - plate * 0.85);
    }
    if (water.sparks.x > 0.0) {
        colour += water.foam.rgb * 3.0 * embers(in.world.xy, time, water.sparks.x * 0.6);
    }

    let haze = smoothstep(3500.0, 11000.0, own) * 0.6 * (1.0 - step(0.0001, water.glow.w));
    colour = mix(colour, mix(water.shallow.rgb, vec3<f32>(0.75, 0.9, 0.95), 0.35), haze);

    let edge = 1.0 - smoothstep(0.0, water.foam.w, thickness);
    let crest = smoothstep(0.55, 0.9, frame_height(uv * 2.3 + vec2<f32>(0.0, time * 0.02), time)) * smoothstep(0.92, 1.0, normal.z) * 0.25 * near;
    let ripple = 0.5 + 0.5 * sin(thickness * 0.08 - time * 2.0 + noise(in.world.xy * 0.15) * 6.0);
    let foam = clamp(edge * (0.55 + 0.45 * ripple) * (0.4 + noise(in.world.xy * 0.9 + time * 0.3)) + crest + disturbed.z, 0.0, 1.0);
    colour = mix(colour, water.foam.rgb, foam);

    if (frame.fog_color.w > 0.5) {
        let fog = clamp((own - frame.fog_range.x) / max(frame.fog_range.y - frame.fog_range.x, 1.0), 0.0, frame.fog_range.z);
        colour = mix(colour, frame.fog_color.rgb, fog);
    }
    return vec4<f32>(colour, max(clamp(calm + foam, 0.0, 1.0), water.look.z));
}
