/// <reference lib="dom" />
import "./headlessRender";
import type { SoundCue } from "../../../src/headless/client";
import type { StandaloneFrame, StandaloneInput } from "../standalone";

const held = new Set<string>();
const keys: Readonly<Record<string, string>> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", KeyA: "left", KeyD: "right", KeyW: "up", KeyS: "down", KeyJ: "attack", KeyK: "special", Space: "jump", KeyL: "grab", ShiftLeft: "shield", ShiftRight: "shield", ControlLeft: "walk", Enter: "start", KeyV: "view" };
window.addEventListener("keydown", (event) => { const action = keys[event.code]; if (action !== undefined) { event.preventDefault(); held.add(action); } });
window.addEventListener("keyup", (event) => { const action = keys[event.code]; if (action !== undefined) { event.preventDefault(); held.delete(action); } });
window.addEventListener("blur", () => held.clear());
const status = document.createElement("div"); status.id = "status"; document.body.append(status);
function input(): StandaloneInput {
  const buttons = new Set(held);
  const pad = navigator.getGamepads().find((candidate) => candidate !== null && candidate.connected);
  let axisX = 0, axisY = 0;
  if (pad !== undefined && pad !== null && document.hasFocus()) {
    const mapping = ["attack", "jump", "special", "jump", "walk", "grab", "shield", "shield", "view", "start", "", "", "up", "down", "left", "right"];
    pad.buttons.forEach((button, index) => { const action = mapping[index]; if (action && button.pressed) buttons.add(action); });
    axisX = pad.axes[0] ?? 0; axisY = -(pad.axes[1] ?? 0);
  }
  status.textContent = pad ? `${pad.id} · A attack · X special · B/Y jump · triggers shield` : "Arrows / WASD move · J attack · K special · Space jump · L grab · Shift shield · Enter pause";
  return { buttons: [...buttons], axisX, axisY };
}

const audio = new AudioContext();
const buffers = new Map<string, Promise<AudioBuffer>>();
const pendingAudio = new Set<Promise<void>>();
const missing = new Set<string>();
let audioPlayed = 0, audioEvents = 0, audioReadyEvents = 0;
function sound(cue: SoundCue): void {
  audioEvents++;
  const key = `${cue.source ?? cue.label}:${cue.handle.id}`;
  let buffer = buffers.get(key);
  if (buffer === undefined) {
    buffer = fetch("/sound", { method: "POST", body: JSON.stringify(cue) }).then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      return audio.decodeAudioData(await response.arrayBuffer());
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
const milliseconds: number[] = [], intervals: number[] = [];
let previous = 0;
const percentile = (values: readonly number[], percent: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * percent) - 1)] ?? 0;
async function post(path: string, body: unknown): Promise<Response> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text());
  return response;
}
async function run(): Promise<void> {
  const config = await fetch("/config").then((response) => response.json()) as { width: number; height: number; scripted: boolean };
  const gpu = window.prepareRenderer(config.width, config.height);
  const start = performance.now();
  let nextFrame = start;
  while (true) {
    let presented: number;
    do { presented = await new Promise<number>((resolve) => requestAnimationFrame(resolve)); } while (presented < nextFrame);
    nextFrame = Math.max(nextFrame + 1000 / 60, presented);
    const began = performance.now();
    if (previous !== 0) intervals.push(began - previous);
    previous = began;
    const frame = await post("/frame", config.scripted ? { buttons: [], axisX: 0, axisY: 0 } : input()).then((response) => response.json()) as StandaloneFrame;
    frame.sounds.forEach(sound);
    const rendered = await window.renderScene(frame.scene, { capture: frame.capture });
    if (frame.capture) {
      const blob = await fetch(rendered.png).then((response) => response.blob());
      const response = await fetch(`/capture?frame=${frame.frame}`, { method: "POST", body: blob });
      if (!response.ok) throw new Error(await response.text());
    }
    milliseconds.push(performance.now() - began);
    if (frame.done) {
      await Promise.all(pendingAudio);
      await post("/complete", { gpu, frames: milliseconds.length, elapsedMs: performance.now() - start, frameMs: { p50: percentile(milliseconds, 0.5), p95: percentile(milliseconds, 0.95), p99: percentile(milliseconds, 0.99) }, intervalMs: { p50: percentile(intervals, 0.5), p95: percentile(intervals, 0.95) }, audioEvents, audioReadyEvents, audioPlayed, missingSounds: [...missing] });
      return;
    }
  }
}
void run().catch(async (cause: unknown) => {
  const error = cause instanceof Error ? cause.message : String(cause);
  status.textContent = error;
  await post("/complete", { error }).catch(() => undefined);
});
