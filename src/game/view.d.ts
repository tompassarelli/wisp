export type CameraField = camerafield;
export type FilterBlendMode = blendmode;
export type FilterTexMapFlags = texmapflags;

export declare function setCameraField(field: CameraField, value: number, duration: number): void;
export declare function setCameraBounds(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void;
export declare function setCameraPosition(x: number, y: number): void;
export declare function panCameraTo(x: number, y: number, duration: number): void;
export declare function setCameraSmoothing(factor: number): void;

/** @local */
export declare function cameraField(field: CameraField): number;
/** @local */
export declare function cameraTargetX(): number;
/** @local */
export declare function cameraTargetY(): number;
/** @local */
export declare function cameraTargetZ(): number;
/** @local */
export declare function cameraEyeX(): number;
/** @local */
export declare function cameraEyeY(): number;
/** @local */
export declare function cameraEyeZ(): number;

export declare function setTerrainFog(style: number, start: number, end: number, density: number, red: number, green: number, blue: number): void;
export declare function setTerrainFogHeight(style: number, start: number, end: number, density: number, heightStart: number, heightEnd: number, linearStart: number, linearEnd: number, red: number, green: number, blue: number): void;
export declare function resetTerrainFog(): void;
export declare function setTerrainFogMaxDensity(density: number): void;
export declare function setTerrainFogOverSky(overSky: boolean): void;
export declare function enableFog(enabled: boolean): void;
export declare function enableFogMask(enabled: boolean): void;

export declare function setSkyModel(model: string): void;
export declare function showSky(visible: boolean): void;
export declare function showTerrain(visible: boolean): void;
export declare function setDayNightModels(terrain: string, units: string): void;
export declare function setTimeOfDay(hours: number): void;
export declare function setTimeOfDayScale(scale: number): void;
export declare function setShadowLightCount(count: number): void;

export declare function setFilterTexture(texture: string): void;
export declare function setFilterBlendMode(mode: FilterBlendMode): void;
export declare function setFilterTexMapFlags(flags: FilterTexMapFlags): void;
export declare function setFilterStartUV(minU: number, minV: number, maxU: number, maxV: number): void;
export declare function setFilterEndUV(minU: number, minV: number, maxU: number, maxV: number): void;
export declare function setFilterStartColor(red: number, green: number, blue: number, alpha: number): void;
export declare function setFilterEndColor(red: number, green: number, blue: number, alpha: number): void;
export declare function setFilterDuration(seconds: number): void;
export declare function showFilter(visible: boolean): void;
