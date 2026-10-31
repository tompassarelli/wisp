import type { Player } from "./players";

export type Body = unit;
export type Location = location;

export declare function mapCenter(): Location;
export declare function locationX(location: Location): number;
export declare function locationY(location: Location): number;
export declare function removeLocation(location: Location): void;

export declare function createBody(player: Player, kind: number, x: number, y: number, facing: number): Body;
export declare function removeBody(body: Body): void;
export declare function setBodyX(body: Body, x: number): void;
export declare function setBodyY(body: Body, y: number): void;
/** `rate` is how fast the body climbs to `height`; 0 puts it there at once. */
export declare function setBodyHeight(body: Body, height: number, rate: number): void;
export declare function setBodyFacing(body: Body, degrees: number): void;
export declare function setBodyColor(body: Body, color: number): void;
export declare function setBodyTint(body: Body, red: number, green: number, blue: number, alpha: number): void;
export declare function setBodyScale(body: Body, x: number, y: number, z: number): void;
export declare function setBodyTimeScale(body: Body, scale: number): void;
export declare function setBodyAnimation(body: Body, name: string): void;
export declare function setBodyAnimationIndex(body: Body, index: number): void;
export declare function showBody(body: Body, show: boolean): void;
export declare function setBodyTeamGlow(body: Body, show: boolean): void;

/** @local */
export declare function bodyHidden(body: Body): boolean;
/** @local */
export declare function bodyKind(body: Body): number;
/** @local */
export declare function bodyMoveSpeed(body: Body): number;
/** @local */
export declare function bodyAttackCooldown(body: Body): number;

/** Sets up Warcraft's unit and does nothing on the native backend. */
export declare function setBodyName(body: Body, name: string): void;
export declare function setBodySelectionScale(body: Body, scale: number): void;
export declare function setBodyMoveSpeed(body: Body, speed: number): void;
export declare function setBodyAttackCooldown(body: Body, cooldown: number): void;
export declare function setBodyBlendTime(body: Body, seconds: number): void;
export declare function setBodyInvulnerable(body: Body, invulnerable: boolean): void;
export declare function setBodyPathing(body: Body, pathing: boolean): void;
export declare function pauseBody(body: Body, paused: boolean): void;
export declare function addBodyAbility(body: Body, ability: number): void;
export declare function removeBodyAbility(body: Body, ability: number): void;
export declare function setAbilityTooltip(ability: number, tooltip: string, level: number): void;
