import { f32 } from "../../sim/f32";
import { copyBlend, freshAnimation, seekAnimation, selectAnimation, settleAnimation } from "./animation";
import type { EffectDeaths, EffectPose, Handle, HandleFactory } from "./types";
import { FRAMES_PER_SECOND } from "./frameRate";

export class Effects {
  private readonly poses = new Map<Handle, EffectPose>();
  /** Destroyed effects in destruction order, so expiry reads only the oldest. */
  private readonly dying: EffectPose[] = [];
  // Effect poses advance when read: each remembers how many draws it has taken,
  // and every draw it hasn't taken since was `drawSeconds` long.
  private readonly settled = new WeakMap<EffectPose, number>();
  private draws = 0;
  private drawSeconds = 0;

  constructor(private readonly handle: HandleFactory, private readonly deaths: EffectDeaths | undefined, private readonly frame: (this: void) => number) {}

  create(model: string, x: number, y: number): Handle {
    const handle = this.handle("effect");
    const pose: EffectPose = { ...freshAnimation(), handle, model, created: this.frame(), x: f32(x), y: f32(y), z: 0, alpha: 255, scale: 1, timeScale: 1, flat: false, queuedAnimations: [],
      yaw: 0, pitch: 0, roll: 0, color: [255, 255, 255], teamColor: 0, matrixScale: [1, 1, 1] };
    this.poses.set(handle, pose);
    this.settled.set(pose, this.draws);
    return handle;
  }

  live(effect: Handle): EffectPose | undefined {
    const pose = this.poses.get(effect);
    return pose?.destroyed === undefined ? pose : undefined;
  }

  /** Brings the pose's animation clocks up to the last draw before anything reads them or changes how they advance. */
  private settle(pose: EffectPose): void {
    const settled = this.settled.get(pose) ?? this.draws;
    if (settled === this.draws) return;
    settleAnimation(pose, pose.timeScale, this.drawSeconds, this.draws - settled);
    this.settled.set(pose, this.draws);
  }

  destroy(effect: Handle): void {
    const pose = this.live(effect);
    if (pose === undefined) return;
    const death = this.deaths?.(pose.model);
    this.settle(pose);
    pose.destroyed = this.frame();
    this.dying.push(pose);
    pose.queuedAnimations.length = 0;
    if (death !== undefined && death > 0) {
      pose.death = death;
      selectAnimation(pose, "death", []);
    }
  }

  play(effect: Handle, animation: string | number, timeScale?: number): void {
    const pose = this.live(effect);
    if (pose === undefined) return;
    this.settle(pose);
    selectAnimation(pose, animation, undefined, true);
    if (timeScale !== undefined) pose.timeScale = f32(timeScale);
  }

  snapshot(options: { readonly visibleOnly?: boolean }): EffectPose[] {
    const poses: EffectPose[] = [];
    for (const pose of this.poses.values()) if (options.visibleOnly !== true || (pose.alpha > 0 && pose.scale > 0 && !pose.flat)) {
      this.settle(pose);
      poses.push({ ...pose, subAnimations: [...pose.subAnimations], animationBlend: copyBlend(pose.animationBlend), color: [...pose.color], matrixScale: [...pose.matrixScale] });
    }
    return poses;
  }

  draw(step: number): void {
    if (step !== this.drawSeconds) {
      for (const pose of this.poses.values()) this.settle(pose);
      this.drawSeconds = step;
    }
    this.draws++;
  }

  expire(frame: number): void {
    let expired = 0;
    while (expired < this.dying.length && frame - (this.dying[expired]?.destroyed ?? frame) >= 5 * FRAMES_PER_SECOND) expired++;
    if (expired > 0) for (const pose of this.dying.splice(0, expired)) if (this.poses.get(pose.handle) === pose) this.poses.delete(pose.handle);
  }

  remove(effect: Handle): void { if (this.live(effect) !== undefined) this.poses.delete(effect); }

  setAnimationBlendTime(effect: Handle, time: number): void {
    const pose = this.live(effect);
    if (pose !== undefined) pose.animationBlendTime = f32(time);
  }

  setAnimation(effect: Handle, animation: string): void {
    const pose = this.live(effect);
    if (pose !== undefined) { pose.queuedAnimations.length = 0; this.play(effect, animation); }
  }

  queueAnimation(effect: Handle, animation: string): void {
    const pose = this.live(effect);
    if (pose !== undefined) pose.queuedAnimations.push(animation);
  }

  setTimeScale(effect: Handle, timeScale: number): void {
    const pose = this.live(effect);
    if (pose === undefined) return;
    this.settle(pose);
    pose.timeScale = f32(timeScale);
  }

  setTime(effect: Handle, time: number): void {
    const pose = this.live(effect);
    if (pose === undefined) return;
    this.settle(pose);
    seekAnimation(pose, f32(time));
  }

  clearSubAnimations(effect: Handle): void {
    const pose = this.live(effect);
    if (pose !== undefined) pose.subAnimations.length = 0;
  }

  addSubAnimation(effect: Handle, animation: string | number): void {
    const pose = this.live(effect);
    if (pose !== undefined && !pose.subAnimations.includes(animation)) pose.subAnimations.push(animation);
  }

  removeSubAnimation(effect: Handle, animation: string | number): void {
    const pose = this.live(effect);
    if (pose === undefined) return;
    const index = pose.subAnimations.indexOf(animation);
    if (index >= 0) pose.subAnimations.splice(index, 1);
  }

  // Destroyed effects still playing Death retain their position.
  x(effect: Handle): number { return this.poses.get(effect)?.x ?? 0; }
  y(effect: Handle): number { return this.poses.get(effect)?.y ?? 0; }
  z(effect: Handle): number { return this.poses.get(effect)?.z ?? 0; }
  scale(effect: Handle): number { return this.live(effect)?.scale ?? 0; }

  // Effect reals are stored as binary32 (wisp:docs/warsmash-notes.md, "Effects: attachment, scale and lifetime").

  setPosition(effect: Handle, x: number, y: number, z: number): void {
    const pose = this.live(effect);
    if (pose === undefined) return;
    pose.x = f32(x);
    pose.y = f32(y);
    pose.z = f32(z);
  }

  setX(effect: Handle, x: number): void {
    const pose = this.live(effect);
    if (pose !== undefined) pose.x = f32(x);
  }

  setY(effect: Handle, y: number): void {
    const pose = this.live(effect);
    if (pose !== undefined) pose.y = f32(y);
  }

  setZ(effect: Handle, z: number): void {
    const pose = this.live(effect);
    if (pose !== undefined) pose.z = f32(z);
  }

  setAlpha(effect: Handle, alpha: number): void {
    const pose = this.live(effect);
    if (pose !== undefined) pose.alpha = alpha;
  }

  setScale(effect: Handle, scale: number): void {
    const pose = this.live(effect);
    if (pose !== undefined) pose.scale = f32(scale);
  }

  setOrientation(effect: Handle, yaw: number, pitch: number, roll: number): void {
    const pose = this.live(effect);
    if (pose === undefined) return;
    pose.yaw = f32(yaw);
    pose.pitch = f32(pitch);
    pose.roll = f32(roll);
    pose.matrixScale = [1, 1, 1];
    pose.flat = false;
  }

  setYaw(effect: Handle, yaw: number): void {
    const pose = this.live(effect);
    if (pose === undefined) return;
    pose.yaw = f32(yaw);
    pose.matrixScale = [1, 1, 1];
    pose.flat = false;
  }

  setPitch(effect: Handle, pitch: number): void {
    const pose = this.live(effect);
    if (pose === undefined) return;
    pose.pitch = f32(pitch);
    pose.matrixScale = [1, 1, 1];
    pose.flat = false;
  }

  setRoll(effect: Handle, roll: number): void {
    const pose = this.live(effect);
    if (pose === undefined) return;
    pose.roll = f32(roll);
    pose.matrixScale = [1, 1, 1];
    pose.flat = false;
  }

  setColor(effect: Handle, r: number, g: number, b: number): void {
    const pose = this.live(effect);
    if (pose !== undefined) pose.color = [r, g, b];
  }

  setTeamColor(effect: Handle, player: number): void {
    const pose = this.live(effect);
    if (pose !== undefined) pose.teamColor = player;
  }

  setMatrixScale(effect: Handle, x: number, y: number, z: number): void {
    const pose = this.live(effect);
    if (pose === undefined) return;
    pose.matrixScale = [f32(pose.matrixScale[0] * f32(x)), f32(pose.matrixScale[1] * f32(y)), f32(pose.matrixScale[2] * f32(z))];
    pose.flat = pose.matrixScale.includes(0);
  }

  resetMatrix(effect: Handle): void {
    const pose = this.live(effect);
    if (pose === undefined) return;
    pose.flat = false;
    pose.matrixScale = [1, 1, 1];
    pose.yaw = 0;
    pose.pitch = 0;
    pose.roll = 0;
  }
}
