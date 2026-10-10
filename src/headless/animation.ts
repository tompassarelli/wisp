import { f32 } from "../sim/f32";
import { floorMod } from "../sim/intMath";

export interface AnimationSequence {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly looping: boolean;
  readonly rarity: number;
}

export interface SavedAnimation {
  readonly animation: string | number | undefined;
  readonly subAnimations: readonly (string | number)[];
  readonly elapsed: number;
}

export interface AnimationBlend {
  readonly from: SavedAnimation;

  remaining: number;
}

export interface AnimationState {
  animation: string | number | undefined;
  subAnimations: (string | number)[];

  animationElapsed: number;

  animationClock: number;
  animationBlendTime: number;
  animationBlend: AnimationBlend | undefined;
  /** Effect selections restart once on the next drawn frame, after the caller's writes. */
  animationRestartPending?: boolean;
}

export function freshAnimation(): AnimationState {
  return { animation: undefined, subAnimations: [], animationElapsed: 0, animationClock: 0, animationBlendTime: 0, animationBlend: undefined };
}

export function selectAnimation(state: AnimationState, animation: string | number, subAnimations?: readonly (string | number)[], restartOnNextFrame = false): void {
  if (state.animationBlendTime > 0 && state.animation !== undefined && state.animationBlend === undefined && state.animationClock * 1000 >= 1) {
    state.animationBlend = {
      from: { animation: state.animation, subAnimations: [...state.subAnimations], elapsed: state.animationElapsed },
      remaining: f32(state.animationBlendTime * 1000),
    };
  }
  state.animation = animation;
  if (subAnimations !== undefined) state.subAnimations = [...subAnimations];
  state.animationElapsed = 0;
  state.animationRestartPending = restartOnNextFrame;
}

export function seekAnimation(state: AnimationState, seconds: number): void {
  state.animationElapsed = seconds;
}

// Advance clocks in binary32 so Bun and Lua floor the same animation frames.

export function advanceAnimation(state: AnimationState, timeScale: number, frameSeconds: number): void {
  if (state.animationRestartPending) {
    state.animationElapsed = 0;
    state.animationRestartPending = false;
  }
  const step = f32(timeScale * frameSeconds);
  if (step === 0) return;
  state.animationElapsed = f32(state.animationElapsed + step);
  state.animationClock = f32(state.animationClock + step);
  const blend = state.animationBlend;
  if (blend === undefined) return;
  blend.remaining = f32(blend.remaining - f32(step * 1000));
  if (blend.remaining <= 0) state.animationBlend = undefined;
}

export function blendWeight(state: AnimationState): number {
  const blend = state.animationBlend;
  if (blend === undefined || state.animationBlendTime <= 0) return 0;
  return Math.min(1, blend.remaining / (state.animationBlendTime * 1000));
}

const PRIMARY_TAGS = ["attack", "birth", "death", "decay", "dissipate", "morph", "portrait", "sleep", "spell", "stand", "walk"];
const SECONDARY_TAGS = ["alternate", "alternateex", "berserk", "bone", "chain", "chainlightning", "channel", "cinematic", "complete",
  "critical", "defend", "drain", "eattree", "entangle", "fast", "fifth", "fill", "fire", "first", "five", "flail", "flesh", "four",
  "fourth", "gold", "hit", "large", "left", "light", "looping", "lumber", "medium", "moderate", "off", "one", "puke", "ready", "right",
  "rooted", "second", "severe", "slam", "small", "spiked", "spin", "swim", "talk", "third", "three", "throw", "turn", "two", "upgrade",
  "victory", "work", "wounded"];

export interface AnimationTags {
  readonly primary: readonly string[];

  readonly secondary: readonly string[];
}

function tagWord(word: string): string {
  let text = word.toLowerCase();
  if (text.startsWith("anim_type_")) text = text.substring(10);
  if (text.startsWith("subanim_type_")) text = text.substring(13);
  let joined = "";
  for (let index = 0; index < text.length; index++) if (text.charAt(index) !== "_") joined += text.charAt(index);
  return joined;
}

function words(name: string): string[] {
  const out: string[] = [];
  let current = "";
  for (let index = 0; index <= name.length; index++) {
    const character = index < name.length ? name.charAt(index) : " ";
    if (character === " " || character === "\t" || character === "," || character === "\n" || character === "\r") {
      if (current !== "") out.push(current);
      current = "";
    } else current += character;
  }
  return out;
}

export function animationTags(name: string, extra: readonly (string | number)[] = []): AnimationTags {
  const primary: string[] = [];
  const secondary: string[] = [];
  for (const word of words(name)) {
    const tag = tagWord(word);
    if (PRIMARY_TAGS.includes(tag)) { if (!primary.includes(tag)) primary.push(tag); }
    else if (SECONDARY_TAGS.includes(tag)) { if (!secondary.includes(tag)) secondary.push(tag); }
    else break;
  }
  for (const part of extra) {
    const tag = tagWord(typeof part === "number" ? `${part}` : part);
    if (SECONDARY_TAGS.includes(tag) && !secondary.includes(tag)) secondary.push(tag);
  }
  secondary.sort();
  return { primary, secondary };
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

export function selectSequence(sequences: readonly AnimationSequence[], animation: string | number, subAnimations: readonly (string | number)[] = []): number {
  if (typeof animation === "number") return animation >= 0 && animation < sequences.length ? animation : -1;
  const wanted = animationTags(animation, subAnimations);
  const tags = sequences.map((sequence) => animationTags(sequence.name));
  let primary = wanted.primary[0];
  const eligible = (own: AnimationTags) => primary === undefined || own.primary.includes(primary);
  let chosen: readonly string[] | undefined;
  for (const own of tags) if (chosen === undefined && eligible(own) && sameTags(own.secondary, wanted.secondary)) chosen = own.secondary;
  if (chosen === undefined) {
    let best = 0;
    for (const own of tags) {
      if (!eligible(own)) continue;
      let shared = 0;
      for (const tag of own.secondary) if (wanted.secondary.includes(tag)) shared++;
      if (shared > best || (shared > 0 && shared === best && chosen !== undefined && own.secondary.length < chosen.length)) {
        best = shared;
        chosen = own.secondary;
      }
    }
  }
  if (chosen === undefined) {
    primary ??= "stand";
    for (const own of tags) if (own.primary.includes(primary) && (chosen === undefined || own.secondary.length < chosen.length)) chosen = own.secondary;
  }
  if (chosen === undefined) return -1;
  let found = -1;
  for (let index = 0; index < sequences.length; index++) {
    const own = tags[index];
    if (own === undefined || !eligible(own) || !sameTags(own.secondary, chosen)) continue;
    if (found < 0 || (sequences[index]?.rarity ?? 0) < (sequences[found]?.rarity ?? 0)) found = index;
  }
  return found;
}

// Looping MDX sequences keep overshoot; non-looping sequences hold the interval end.

export function sequenceFrame(sequence: AnimationSequence, ms: number, looping = sequence.looping): number {
  const length = sequence.end - sequence.start;
  if (length <= 0) return sequence.start;
  return sequence.start + Math.floor(looping ? floorMod(ms, length) : Math.min(ms, length));
}

export interface SequenceSample {

  readonly sequence: number;
  readonly frame: number;
}

export function animationSample(sequences: readonly AnimationSequence[], animation: SavedAnimation, kind: "effect" | "unit"): SequenceSample {
  const ms = f32(animation.elapsed * 1000);
  if (animation.animation !== undefined) {
    let index = selectSequence(sequences, animation.animation, animation.subAnimations);
    if (index < 0) index = selectSequence(sequences, "stand");
    const sequence = sequences[index];
    return sequence === undefined ? { sequence: -1, frame: 0 } : { sequence: index, frame: sequenceFrame(sequence, ms) };
  }
  let standIndex = selectSequence(sequences, "stand");
  if (standIndex < 0 && sequences.length > 0) standIndex = 0;
  const stand = sequences[standIndex];
  const birthIndex = kind === "effect" ? selectSequence(sequences, "birth") : -1;
  const birth = sequences[birthIndex];
  if (birth !== undefined && animationTags(birth.name).primary.includes("birth")) {
    const length = birth.end - birth.start;
    if (stand === undefined || ms < length) return { sequence: birthIndex, frame: sequenceFrame(birth, ms, false) };
    return { sequence: standIndex, frame: sequenceFrame(stand, ms - length, true) };
  }
  if (stand === undefined) return { sequence: -1, frame: 0 };
  return { sequence: standIndex, frame: sequenceFrame(stand, ms, kind === "effect" ? true : stand.looping) };
}

export function globalSequenceFrame(clockSeconds: number, length: number): number {
  if (length <= 0) return 0;
  return floorMod(Math.floor(f32(clockSeconds * 1000)), length);
}
