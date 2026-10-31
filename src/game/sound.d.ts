export type Sound = sound;
export type VolumeGroup = volumegroup;

export declare function createSound(file: string, looping: boolean, positional: boolean, stopOutOfRange: boolean, fadeInRate: number, fadeOutRate: number, environment: string): Sound;
export declare function soundFromLabel(label: string, looping: boolean, positional: boolean, stopOutOfRange: boolean, fadeInRate: number, fadeOutRate: number): Sound;
export declare function playSound(sound: Sound): void;
export declare function stopSound(sound: Sound, release: boolean, fadeOut: boolean): void;
export declare function setSoundVolume(sound: Sound, volume: number): void;
export declare function setSoundPitch(sound: Sound, pitch: number): void;
export declare function setSoundPosition(sound: Sound, x: number, y: number, z: number): void;
export declare function setSoundDistances(sound: Sound, nearest: number, farthest: number): void;
export declare function setSoundCutoff(sound: Sound, distance: number): void;
export declare function setSoundDuration(sound: Sound, milliseconds: number): void;
export declare function releaseWhenDone(sound: Sound): void;
export declare function soundFileDuration(file: string): number;

export declare function playMusic(file: string): void;
export declare function stopMusic(fadeOut: boolean): void;
export declare function clearMusic(): void;
export declare function playTheme(file: string): void;
export declare function endTheme(): void;

export declare function setVolumeGroup(group: VolumeGroup, scale: number): void;
export declare function resetVolumeGroups(): void;
