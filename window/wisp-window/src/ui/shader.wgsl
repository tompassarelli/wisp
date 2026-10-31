struct Screen { size: vec2<f32> };
@group(0) @binding(0) var<uniform> screen: Screen;
@group(1) @binding(0) var image: texture_2d<f32>;
@group(1) @binding(1) var pick: sampler;

struct Quad {
    @location(0) rect: vec4<f32>,
    @location(1) uv: vec4<f32>,
    @location(2) color: vec4<f32>,
    @location(3) coverage: u32,
};
struct Out {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) @interpolate(flat) coverage: u32,
};

@vertex fn vs(@builtin(vertex_index) corner: u32, quad: Quad) -> Out {
    let at = vec2<f32>(f32(corner & 1u), f32(corner >> 1u));
    let pixel = quad.rect.xy + at * quad.rect.zw;
    var out: Out;
    out.position = vec4<f32>(pixel.x / screen.size.x * 2.0 - 1.0, 1.0 - pixel.y / screen.size.y * 2.0, 0.0, 1.0);
    out.uv = mix(quad.uv.xy, quad.uv.zw, select(at, at.yx, quad.coverage == 4u));
    out.color = quad.color;
    out.coverage = quad.coverage;
    return out;
}

@fragment fn fs(input: Out) -> @location(0) vec4<f32> {
    let straight = shade(input);
    if (input.coverage == 5u) {
        return vec4<f32>(straight.rgb * straight.a, 0.0);
    }
    return vec4<f32>(straight.rgb * straight.a, straight.a);
}

fn shade(input: Out) -> vec4<f32> {
    let sample = textureSample(image, pick, input.uv);
    if (input.coverage == 2u) {
        return input.color;
    }
    if (input.coverage == 1u) {
        return vec4<f32>(input.color.rgb, input.color.a * sample.r);
    }
    if (input.coverage == 3u) {
        let lit = clamp(sample.rgb / max(sample.a, 0.0001), vec3<f32>(0.0), vec3<f32>(1.0));
        let display = select(1.055 * pow(lit, vec3<f32>(1.0 / 2.4)) - 0.055, lit * 12.92, lit <= vec3<f32>(0.0031308));
        return vec4<f32>(display, sample.a) * input.color;
    }
    return sample * input.color;
}
