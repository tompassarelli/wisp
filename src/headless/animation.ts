// Warcraft's animation playback rules for units and effects, shared by the
// headless runtime, which keeps each clock, and the renderer, which samples
// the model. The rules and their evidence are listed in
// wisp:docs/warsmash-notes.md, "Animation playback".
import { floorMod } from "../sim/intMath";

/** A model sequence: its MDX interval in milliseconds. */
export interface AnimationSequence {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly looping: boolean;
  readonly rarity: number;
}

/** The clock and selection pose of the sequence that was playing when a blend began. */
export interface SavedAnimation {
  readonly animation: string | number | undefined;
  readonly subAnimations: readonly (string | number)[];
  readonly elapsed: number;
  readonly sought: number;
  readonly ticks: number;
}

export interface AnimationBlend {
  readonly from: SavedAnimation;
  /** Milliseconds of animation time left before the new pose shows alone. */
  remaining: number;
}

/** What a unit or effect remembers about its animation. Times are in seconds. */
export interface AnimationState {
  animation: string | number | undefined;
  subAnimations: (string | number)[];
  /** Seconds into the current animation: the last seek plus the time advanced since. */
  animationElapsed: number;
  /** Where the last selection (0) or seek put the clock. */
  animationSought: number;
  /** Frames that moved the clock since the last selection or seek. */
  animationTicks: number;
  /** Animation time since creation, which drives the model's global sequences; selections and seeks keep it. */
  animationClock: number;
  animationBlendTime: number;
  animationBlend: AnimationBlend | undefined;
}

export function freshAnimation(): AnimationState {
  return { animation: undefined, subAnimations: [], animationElapsed: 0, animationSought: 0, animationTicks: 0,
    animationClock: 0, animationBlendTime: 0, animationBlend: undefined };
}

/**
 * Selecting a sequence restarts its clock. With a blend time, a unit that has
 * already animated keeps its old pose and fades it out; a selection during a
 * blend leaves that blend running.
 */
export function selectAnimation(state: AnimationState, animation: string | number, subAnimations?: readonly (string | number)[]): void {
  if (state.animationBlendTime > 0 && state.animation !== undefined && state.animationBlend === undefined && state.animationClock * 1000 >= 1) {
    state.animationBlend = {
      from: { animation: state.animation, subAnimations: [...state.subAnimations], elapsed: state.animationElapsed, sought: state.animationSought, ticks: state.animationTicks },
      remaining: state.animationBlendTime * 1000,
    };
  }
  state.animation = animation;
  if (subAnimations !== undefined) state.subAnimations = [...subAnimations];
  state.animationElapsed = 0;
  state.animationSought = 0;
  state.animationTicks = 0;
}

/** A seek moves the sample time without spending blend time. */
export function seekAnimation(state: AnimationState, seconds: number): void {
  state.animationElapsed = seconds;
  state.animationSought = seconds;
  state.animationTicks = 0;
}

/** One frame: the clock, the global clock and the blend all move by elapsed × time scale. */
export function advanceAnimation(state: AnimationState, timeScale: number, frameSeconds: number): void {
  const step = timeScale * frameSeconds;
  if (step === 0) return;
  state.animationElapsed += step;
  state.animationClock += step;
  state.animationTicks++;
  const blend = state.animationBlend;
  if (blend === undefined) return;
  blend.remaining -= step * 1000;
  if (blend.remaining <= 0) state.animationBlend = undefined;
}

/** How much of the saved pose still shows, from 1 at the switch to 0. */
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
  /** Sorted, without repeats. */
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

/**
 * A name's leading words that are animation tags: "Stand Hit - 2" is stand
 * with hit. The first word that is no tag ends the list.
 */
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

/**
 * The sequence a name selects, or -1 for none: the primary tag with exactly
 * the requested secondary tags; failing that, the secondary set sharing most
 * requested tags (the fewest tags on a tie); failing that, the plainest
 * sequence of the primary tag (stand when the name has none). Warcraft draws
 * among equal variants at random, weighted by rarity; Wisp takes the first of
 * the most common.
 */
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

/**
 * The integer MDX frame a sequence shows. The clock starts where the last
 * selection or seek put it and moves by an even step on each of `ticks`
 * frames. Reaching the interval end minus 1 ms, a looping sequence restarts
 * at its start, dropping the overshoot; any other holds there.
 */
export function sequenceFrame(sequence: AnimationSequence, soughtMs: number, advancedMs: number, ticks: number, looping = sequence.looping): number {
  const start = sequence.start;
  const last = Math.max(start, sequence.end - 1);
  let position = start + soughtMs;
  if (position >= last) position = looping ? start : last;
  if (ticks <= 0 || advancedMs <= 0) return Math.floor(position);
  if (!looping) return Math.floor(Math.min(last, position + advancedMs));
  const step = advancedMs / ticks;
  const first = Math.max(1, Math.ceil((last - position) / step));
  if (ticks < first) return Math.floor(position + ticks * step);
  const period = Math.max(1, Math.ceil((last - start) / step));
  return Math.floor(start + floorMod(ticks - first, period) * step);
}

export interface SequenceSample {
  /** -1 for no sequence: every track takes its default value. */
  readonly sequence: number;
  readonly frame: number;
}

/**
 * The sequence and frame an animation state shows. A name that selects
 * nothing keeps Stand. A unit never told what to play shows Stand; an
 * effect shows Birth once, then Stand looping.
 */
export function animationSample(sequences: readonly AnimationSequence[], animation: SavedAnimation, kind: "effect" | "unit"): SequenceSample {
  const soughtMs = animation.sought * 1000;
  const advancedMs = (animation.elapsed - animation.sought) * 1000;
  const ticks = animation.ticks;
  if (animation.animation !== undefined) {
    let index = selectSequence(sequences, animation.animation, animation.subAnimations);
    if (index < 0 && typeof animation.animation === "string") index = selectSequence(sequences, "stand");
    const sequence = sequences[index];
    return sequence === undefined ? { sequence: -1, frame: 0 } : { sequence: index, frame: sequenceFrame(sequence, soughtMs, advancedMs, ticks) };
  }
  let standIndex = selectSequence(sequences, "stand");
  if (standIndex < 0 && sequences.length > 0) standIndex = 0;
  const stand = sequences[standIndex];
  const birthIndex = kind === "effect" ? selectSequence(sequences, "birth") : -1;
  const birth = sequences[birthIndex];
  if (birth !== undefined && animationTags(birth.name).primary.includes("birth")) {
    const last = Math.max(birth.start, birth.end - 1);
    const position = birth.start + soughtMs;
    const step = ticks > 0 ? advancedMs / ticks : 0;
    const birthTicks = position >= last ? 0 : step > 0 ? Math.max(1, Math.ceil((last - position) / step)) : ticks + 1;
    if (stand === undefined || ticks < birthTicks) return { sequence: birthIndex, frame: sequenceFrame(birth, soughtMs, advancedMs, ticks, false) };
    const after = ticks - birthTicks;
    return { sequence: standIndex, frame: sequenceFrame(stand, 0, after * step, after, true) };
  }
  if (stand === undefined) return { sequence: -1, frame: 0 };
  return { sequence: standIndex, frame: sequenceFrame(stand, soughtMs, advancedMs, ticks, kind === "effect" ? true : stand.looping) };
}

/** A global sequence's frame: integer animation time since creation, wrapped by its length. */
export function globalSequenceFrame(clockSeconds: number, length: number): number {
  if (length <= 0) return 0;
  return floorMod(Math.floor(clockSeconds * 1000), length);
}
