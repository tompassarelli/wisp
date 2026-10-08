/// <reference lib="dom" />
import "./headlessRender";
import type { SoundCue } from "../../../src/headless/client";
import type { StandaloneFrame, StandaloneInput } from "../standalone";
import type { RenderScene } from "../headlessRender";

const held = new Set<string>();
let gamepadIndex: number | undefined;
const keys: Readonly<Record<string, string>> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", KeyA: "left", KeyD: "right", KeyW: "up", KeyS: "down", KeyJ: "attack", KeyK: "special", Space: "jump", KeyL: "grab", ShiftLeft: "shield", ShiftRight: "shield", ControlLeft: "walk", Enter: "start", KeyV: "view" };
window.addEventListener("keydown", (event) => { const action = keys[event.code]; if (action !== undefined) { event.preventDefault(); held.add(action); } });
window.addEventListener("keyup", (event) => { const action = keys[event.code]; if (action !== undefined) { event.preventDefault(); held.delete(action); } });
window.addEventListener("blur", () => held.clear());
const status = document.createElement("div"); status.id = "status"; document.body.append(status);
function input(): StandaloneInput {
  const buttons = new Set(held);
  const pads = navigator.getGamepads();
  const pad = gamepadIndex === undefined ? pads.find((candidate) => candidate !== null && candidate.connected) : pads[gamepadIndex];
  let axisX = 0, axisY = 0;
  if (pad !== undefined && pad !== null && document.hasFocus()) {
    const mapping = ["attack", "jump", "special", "jump", "walk", "grab", "shield", "shield", "view", "start", "", "", "up", "down", "left", "right"];
    pad.buttons.forEach((button, index) => { const action = mapping[index]; if (action && button.pressed) buttons.add(action); });
    axisX = pad.axes[0] ?? 0; axisY = -(pad.axes[1] ?? 0);
  }
  const help = pad ? `${pad.id} · A attack · X special · B/Y jump · triggers shield` : "Arrows / WASD move · J attack · K special · Space jump · L grab · Shift shield · Enter pause";
  // Rewriting identical text still relayouts and repaints the whole page every frame.
  if (status.textContent !== help) status.textContent = help;
  return { buttons: [...buttons], axisX, axisY };
}

const audio = new AudioContext();
const buffers = new Map<string, Promise<AudioBuffer>>();
const decodedAssets = new Map<string, Promise<AudioBuffer>>();
const pendingAudio = new Set<Promise<void>>();
const missing = new Set<string>();
let audioPlayed = 0, audioEvents = 0, audioReadyEvents = 0, audioDecodedAssets = 0;
let soundRequests = 0;
const soundQueue: (() => void)[] = [];
async function soundBytes(cue: SoundCue): Promise<{ path: string; bytes: ArrayBuffer }> {
  // Leave HTTP connections available for frame delivery while sound assets load.
  if (soundRequests === 4) await new Promise<void>((resolve) => soundQueue.push(resolve));
  else soundRequests++;
  try {
    const response = await fetch("/sound", { method: "POST", body: JSON.stringify(cue) });
    if (!response.ok) throw new Error(await response.text());
    const path = response.headers.get("x-wisp-sound-path");
    if (path === null) throw new Error("sound asset path missing");
    return { path: path.replaceAll("\\", "/").toLowerCase(), bytes: await response.arrayBuffer() };
  } finally {
    const next = soundQueue.shift();
    if (next === undefined) soundRequests--;
    else next();
  }
}
function sound(cue: SoundCue): void {
  audioEvents++;
  const key = `${cue.source ?? cue.label}:${cue.handle.id}`;
  let buffer = buffers.get(key);
  if (buffer === undefined) {
    buffer = soundBytes(cue).then(({ path, bytes }) => {
      let decoded = decodedAssets.get(path);
      if (decoded === undefined) {
        decoded = audio.decodeAudioData(bytes).then((asset) => { audioDecodedAssets++; return asset; });
        decodedAssets.set(path, decoded);
      }
      return decoded;
    });
    buffers.set(key, buffer);
  }
  const task = buffer.then(async (decoded) => {
    audioReadyEvents++;
    if (cue.event !== "start") return;
    if (audio.state === "suspended") await audio.resume();
    const source = audio.createBufferSource(), gain = audio.createGain();
    source.buffer = decoded; source.playbackRate.value = Math.max(0.01, cue.pitch);
    gain.gain.value = Math.max(0, Math.min(1, cue.volume / 127));
    source.connect(gain).connect(audio.destination); source.start(); audioPlayed++;
  }).catch((cause: unknown) => { missing.add(cause instanceof Error ? cause.message : String(cause)); });
  pendingAudio.add(task); void task.finally(() => pendingAudio.delete(task));
}
const milliseconds: number[] = [], intervals: number[] = [], requests: number[] = [], renders: number[] = [];
const timings: { step: number; frame: number; rafTimestampMs: number; callbackMs: number; deadlineMs: number; requestedMs: number; readyMs: number; drawnMs: number }[] = [];
let previous = 0;
const percentile = (values: readonly number[], percent: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * percent) - 1)] ?? 0;
async function post(path: string, body: unknown): Promise<Response> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text());
  return response;
}
async function run(): Promise<void> {
  status.textContent = "Loading game…";
  const startup = performance.now();
  const config = await fetch("/config").then((response) => response.json()) as { width: number; height: number; scripted: boolean; samples: boolean; gamepadIndex?: number };
  gamepadIndex = config.gamepadIndex;
  const gpu = window.prepareRenderer(config.width, config.height);
  const preparation = await fetch("/prepare").then((response) => response.json()) as { scene: RenderScene; models: readonly string[]; step: number };
  const prepared = await window.prepareScene(preparation.scene, preparation.models, (completed, total) => { status.textContent = `Loading game… ${Math.floor(completed * 100 / Math.max(1, total))}%`; });
  const startupMs = performance.now() - startup;
  status.textContent = "Ready to play";
  const start = performance.now();
  let nextFrame = start;
  const loadFrame = async () => {
    const requestedMs = performance.now();
    const frame = await post("/frame", config.scripted ? { buttons: [], axisX: 0, axisY: 0 } : input()).then(response => response.json()) as StandaloneFrame;
    return { frame, requestedMs, readyMs: performance.now() };
  };
  let pending = loadFrame();
  let waiting: { deadlineMs: number; resolve(timestamp: number): void } | undefined;
  let animationFrame = 0;
  const animate = (timestamp: number) => {
    animationFrame = requestAnimationFrame(animate);
    if (waiting !== undefined && timestamp >= waiting.deadlineMs) {
      const resolve = waiting.resolve;
      waiting = undefined;
      resolve(timestamp);
    }
  };
  animationFrame = requestAnimationFrame(animate);
  try {
  while (true) {
    const deadlineMs = nextFrame;
    const presented = await new Promise<number>((resolve) => { waiting = { deadlineMs, resolve }; });
    nextFrame = Math.max(nextFrame + 1000 / 60, presented);
    const began = performance.now();
    if (previous !== 0) intervals.push(began - previous);
    previous = began;
    const { frame, requestedMs, readyMs } = await pending;
    frame.sounds.forEach(sound);
    if (!frame.done && !frame.capture) pending = loadFrame();
    const drawStart = performance.now();
    const rendered = await window.renderScene(frame.scene, { capture: frame.capture });
    const drawnMs = performance.now();
    if (frame.capture) {
      const blob = await fetch(rendered.png).then((response) => response.blob());
      const response = await fetch(`/capture?frame=${frame.frame}`, { method: "POST", body: blob });
      if (!response.ok) throw new Error(await response.text());
      if (!frame.done) pending = loadFrame();
    }
    requests.push(readyMs - requestedMs);
    renders.push(drawnMs - drawStart);
    if (config.samples) timings.push({ step: frame.step, frame: frame.frame, rafTimestampMs: presented, callbackMs: began, deadlineMs, requestedMs, readyMs, drawnMs });
    milliseconds.push(performance.now() - began);
    if (frame.done) {
      await Promise.all(pendingAudio);
      await post("/complete", { gpu, startupMs, prepared: { ...prepared, step: preparation.step }, frames: milliseconds.length, elapsedMs: performance.now() - start, frameMs: { p50: percentile(milliseconds, 0.5), p95: percentile(milliseconds, 0.95), p99: percentile(milliseconds, 0.99) }, intervalMs: { p50: percentile(intervals, 0.5), p95: percentile(intervals, 0.95) }, requestMs: { p50: percentile(requests, 0.5), p95: percentile(requests, 0.95) }, renderMs: { p50: percentile(renders, 0.5), p95: percentile(renders, 0.95) }, ...(config.samples ? { frameSamplesMs: milliseconds, intervalSamplesMs: intervals, requestSamplesMs: requests, renderSamplesMs: renders, frameTimings: timings } : {}), audioEvents, audioReadyEvents, audioPlayed, audioDecodedAssets, missingSounds: [...missing] });
      return;
    }
  }
  } finally { cancelAnimationFrame(animationFrame); }
}
void run().catch(async (cause: unknown) => {
  const error = cause instanceof Error ? cause.message : String(cause);
  status.textContent = error;
  await post("/complete", { error }).catch(() => undefined);
});
