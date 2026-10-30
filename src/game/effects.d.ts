export type Effect = effect;
export type Beam = lightning;
export type FloatingText = texttag;
export type Player = player;
export type EffectAnimation = animtype;

export declare function createEffect(model: string, x: number, y: number): Effect;
export declare function destroyEffect(effect: Effect): void;
export declare function setEffectPosition(effect: Effect, x: number, y: number, z: number): void;
export declare function setEffectZ(effect: Effect, z: number): void;
export declare function setEffectScale(effect: Effect, scale: number): void;
export declare function setEffectMatrixScale(effect: Effect, x: number, y: number, z: number): void;
export declare function resetEffectMatrix(effect: Effect): void;
export declare function setEffectOrientation(effect: Effect, yaw: number, pitch: number, roll: number): void;
export declare function setEffectYaw(effect: Effect, yaw: number): void;
export declare function setEffectPitch(effect: Effect, pitch: number): void;
export declare function setEffectRoll(effect: Effect, roll: number): void;
export declare function setEffectAlpha(effect: Effect, alpha: number): void;
export declare function setEffectColor(effect: Effect, red: number, green: number, blue: number): void;
export declare function setEffectTeamColor(effect: Effect, owner: Player): void;
export declare function playEffectAnimation(effect: Effect, animation: EffectAnimation): void;
export declare function setEffectAnimation(effect: Effect, animation: string): void;
export declare function setEffectTime(effect: Effect, seconds: number): void;
export declare function setEffectTimeScale(effect: Effect, timeScale: number): void;
export declare function setEffectBlendTime(effect: Effect, seconds: number): void;
export declare function clearEffectSubAnimations(effect: Effect): void;
export declare function effectScale(effect: Effect): number;

/** @local */
export declare function effectX(effect: Effect): number;
/** @local */
export declare function effectY(effect: Effect): number;
/** @local */
export declare function effectZ(effect: Effect): number;

export declare function createBeam(model: string, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): Beam;
export declare function moveBeam(beam: Beam, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): boolean;
export declare function setBeamColor(beam: Beam, red: number, green: number, blue: number, alpha: number): boolean;
export declare function destroyBeam(beam: Beam): boolean;

export declare function createFloatingText(): FloatingText;
export declare function setFloatingText(text: FloatingText, content: string, height: number): void;
export declare function setFloatingTextPosition(text: FloatingText, x: number, y: number, heightOffset: number): void;
export declare function setFloatingTextColor(text: FloatingText, red: number, green: number, blue: number, alpha: number): void;
export declare function setFloatingTextVisible(text: FloatingText, visible: boolean): void;
export declare function setFloatingTextPermanent(text: FloatingText, permanent: boolean): void;
