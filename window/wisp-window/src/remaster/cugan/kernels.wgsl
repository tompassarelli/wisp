// Real-CUGAN's layers. Tensors are planar f32, `[channel][row][column]`, with the channel stride in `in_cs` and `out_cs`. `OCV` (prepended) is how many vec4 of output channels one thread computes.

struct Params {
    in_c: u32,
    in_w: u32,
    in_h: u32,
    in_cs: u32,
    out_c: u32,
    out_w: u32,
    out_h: u32,
    out_cs: u32,
    stride: u32,
    kernel: u32,
    step: u32,
    flags: u32,
    weights: u32,
    bias: u32,
    res_w: u32,
    res_cs: u32,
    res_off: u32,
    count: u32,
    weights_b: u32,
    bias_b: u32,
    row0: u32,
    pad1: u32,
    pad2: u32,
    pad3: u32,
}

const LEAKY: u32 = 1u;
const RESIDUAL: u32 = 2u;

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read> wts: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> res: array<f32>;
@group(0) @binding(4) var<storage, read_write> dst: array<f32>;

fn finish(x: u32, y: u32, oc0: u32, acc: array<vec4<f32>, OCV>) {
    for (var j = 0u; j < OCV; j++) {
        for (var lane = 0u; lane < 4u; lane++) {
            let c = oc0 + j * 4u + lane;
            if (c < p.out_c) {
                var v = acc[j][lane];
                if ((p.flags & LEAKY) != 0u && v < 0.0) {
                    v = v * 0.1;
                }
                if ((p.flags & RESIDUAL) != 0u) {
                    v = v + res[c * p.res_cs + (y + p.res_off) * p.res_w + x + p.res_off];
                }
                dst[c * p.out_cs + y * p.out_w + x] = v;
            }
        }
    }
}

fn bias_of(oc0: u32) -> array<vec4<f32>, OCV> {
    var acc: array<vec4<f32>, OCV>;
    for (var j = 0u; j < OCV; j++) {
        acc[j] = wts[p.bias + oc0 / 4u + j];
    }
    return acc;
}

// A valid convolution: kernel x kernel taps at `stride`, `step` being the output channels the weights are padded to.
@compute @workgroup_size(8, 8, 1)
fn convolve(@builtin(global_invocation_id) id: vec3<u32>) {
    let g = vec3<u32>(id.x, id.y + p.row0, id.z);
    if (g.x >= p.out_w || g.y >= p.out_h) {
        return;
    }
    let oc0 = g.z * OCV * 4u;
    var acc = bias_of(oc0);
    let taps = p.kernel * p.kernel;
    for (var ic = 0u; ic < p.in_c; ic++) {
        for (var ky = 0u; ky < p.kernel; ky++) {
            let row = ic * p.in_cs + (g.y * p.stride + ky) * p.in_w + g.x * p.stride;
            for (var kx = 0u; kx < p.kernel; kx++) {
                let v = src[row + kx];
                let at = p.weights + ((ic * taps + ky * p.kernel + kx) * p.step + oc0) / 4u;
                for (var j = 0u; j < OCV; j++) {
                    acc[j] += v * wts[at + j];
                }
            }
        }
    }
    finish(g.x, g.y, oc0, acc);
}

// A 2x2 transposed convolution at stride 2: the workgroup's z picks one of the four taps and a block of output channels.
@compute @workgroup_size(8, 8, 1)
fn expand(@builtin(global_invocation_id) id: vec3<u32>) {
    let g = vec3<u32>(id.x, id.y + p.row0, id.z);
    if (g.x >= p.in_w || g.y >= p.in_h) {
        return;
    }
    let tap = g.z & 3u;
    let oc0 = (g.z >> 2u) * OCV * 4u;
    var acc = bias_of(oc0);
    for (var ic = 0u; ic < p.in_c; ic++) {
        let v = src[ic * p.in_cs + g.y * p.in_w + g.x];
        let at = p.weights + ((ic * 4u + tap) * p.step + oc0) / 4u;
        for (var j = 0u; j < OCV; j++) {
            acc[j] += v * wts[at + j];
        }
    }
    finish(g.x * 2u + (tap & 1u), g.y * 2u + (tap >> 1u), oc0, acc);
}

// A 4x4 transposed convolution at stride 2 whose output is cropped by 3 on every side. Each output pixel sums a 2x2 neighbourhood of inputs, and `p.step` is 4.
@compute @workgroup_size(8, 8, 1)
fn expand_wide(@builtin(global_invocation_id) id: vec3<u32>) {
    let g = vec3<u32>(id.x, id.y + p.row0, id.z);
    if (g.x >= p.out_w || g.y >= p.out_h) {
        return;
    }
    let u = g.x + 3u;
    let v = g.y + 3u;
    var acc = bias_of(0u);
    for (var ic = 0u; ic < p.in_c; ic++) {
        for (var dy = 0u; dy < 2u; dy++) {
            let iy = i32(v >> 1u) - i32(dy);
            if (iy < 0 || iy >= i32(p.in_h)) {
                continue;
            }
            let ky = v - 2u * u32(iy);
            for (var dx = 0u; dx < 2u; dx++) {
                let ix = i32(u >> 1u) - i32(dx);
                if (ix < 0 || ix >= i32(p.in_w)) {
                    continue;
                }
                let kx = u - 2u * u32(ix);
                acc[0] += src[ic * p.in_cs + u32(iy) * p.in_w + u32(ix)] * wts[p.weights + (ic * 16u + ky * 4u + kx)];
            }
        }
    }
    finish(g.x, g.y, 0u, acc);
}

// Mean of each channel into `dst[channel]`; one workgroup per channel.
var<workgroup> partial: array<f32, 256>;

@compute @workgroup_size(256)
fn mean(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
    var sum = 0.0;
    for (var i = lid; i < p.count; i += 256u) {
        sum += src[wg.x * p.in_cs + i];
    }
    partial[lid] = sum;
    workgroupBarrier();
    for (var reach = 128u; reach > 0u; reach = reach >> 1u) {
        if (lid < reach) {
            partial[lid] += partial[lid + reach];
        }
        workgroupBarrier();
    }
    if (lid == 0u) {
        dst[wg.x] = partial[0] / f32(p.count);
    }
}

// The squeeze-excitation gate: sigmoid(W2 relu(W1 mean + b1) + b2) into `dst[channel]`. `p.in_c` is the channel count, `p.out_c` the hidden width, `weights` and `bias` the first layer and `weights_b` and `bias_b` the second.
var<workgroup> hidden: array<f32, 16>;

@compute @workgroup_size(128)
fn gate(@builtin(local_invocation_index) lid: u32) {
    let width = p.in_c / 4u;
    if (lid < p.out_c) {
        var sum = wts[p.bias + lid / 4u][lid % 4u];
        for (var j = 0u; j < width; j++) {
            let m = vec4<f32>(src[j * 4u], src[j * 4u + 1u], src[j * 4u + 2u], src[j * 4u + 3u]);
            sum += dot(wts[p.weights + lid * width + j], m);
        }
        hidden[lid] = max(sum, 0.0);
    }
    workgroupBarrier();
    if (lid < p.in_c) {
        var sum = wts[p.bias_b + lid / 4u][lid % 4u];
        for (var h = 0u; h < p.out_c; h++) {
            sum += wts[p.weights_b + lid * (p.out_c / 4u) + h / 4u][h % 4u] * hidden[h];
        }
        dst[lid] = 1.0 / (1.0 + exp(-sum));
    }
}

// Scales every channel of `dst` in place by its gate in `src[channel]`.
@compute @workgroup_size(256)
fn scale(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) lid: u32) {
    let i = (wg.y * 65535u + wg.x) * 256u + lid;
    if (i < p.count) {
        dst[i] = dst[i] * src[i / p.in_cs];
    }
}
