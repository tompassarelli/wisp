import { DdsInfo } from 'dds-parser';
import { mat4 } from 'gl-matrix';
import { quat } from 'gl-matrix';
import { vec3 } from 'gl-matrix';

declare interface AnimKeyframe {
    Frame: number;
    Vector: Float32Array | Int32Array;
    InTan?: Float32Array | Int32Array;
    OutTan?: Float32Array | Int32Array;
}

declare interface AnimVector {
    LineType: LineType;
    GlobalSeqId?: number;
    Keys: AnimKeyframe[];
}

declare interface Attachment extends Node_2 {
    Path?: string;
    AttachmentID?: number;
    Visibility?: AnimVector;
}

declare interface BindPose {
    Matrices: Float32Array[];
}

export declare namespace blp {
    export {
        BLPType,
        BLPContent,
        BLPMipMap,
        BLPImage
    }
}

declare enum BLPContent {
    JPEG = 0,
    Direct = 1
}

declare interface BLPImage {
    type: BLPType;
    width: number;
    height: number;
    content: BLPContent;
    alphaBits: number;
    mipmaps: BLPMipMap[];
    data: ArrayBuffer;
}

declare interface BLPMipMap {
    offset: number;
    size: number;
}

declare enum BLPType {
    BLP0 = 0,
    BLP1 = 1,
    BLP2 = 2
}

declare interface Bone extends Node_2 {
    GeosetId?: number;
    GeosetAnimId?: number;
}

declare interface Camera {
    Name: string;
    Position: Float32Array;
    FieldOfView: number;
    NearClip: number;
    FarClip: number;
    TargetPosition: Float32Array;
    TargetTranslation?: AnimVector;
    Translation?: AnimVector;
    Rotation?: AnimVector;
}

declare interface CollisionShape extends Node_2 {
    Shape: CollisionShapeType;
    Vertices: Float32Array;
    BoundsRadius?: number;
}

declare enum CollisionShapeType {
    Box = 0,
    Sphere = 2
}

declare type DDS_FORMAT = WEBGL_compressed_texture_s3tc['COMPRESSED_RGBA_S3TC_DXT1_EXT'] | WEBGL_compressed_texture_s3tc['COMPRESSED_RGBA_S3TC_DXT3_EXT'] | WEBGL_compressed_texture_s3tc['COMPRESSED_RGBA_S3TC_DXT5_EXT'] | WEBGL_compressed_texture_s3tc['COMPRESSED_RGB_S3TC_DXT1_EXT'];

export declare function decodeBLP(arrayBuffer: ArrayBuffer): BLPImage;

declare interface EventObject extends Node_2 {
    EventTrack: Uint32Array;
}

declare interface FaceFX {
    Name: string;
    Path: string;
}

declare enum FilterMode {
    None = 0,
    Transparent = 1,
    Blend = 2,
    Additive = 3,
    AddAlpha = 4,
    Modulate = 5,
    Modulate2x = 6
}

export declare function generateMDL(model: Model): string;

export declare function generateMDX(model: Model): ArrayBuffer;

declare interface Geoset {
    Vertices: Float32Array;
    Normals: Float32Array;
    TVertices: Float32Array[];
    VertexGroup: Uint8Array;
    Faces: Uint16Array;
    Groups: number[][];
    TotalGroupsCount: number;
    MinimumExtent: Float32Array;
    MaximumExtent: Float32Array;
    BoundsRadius: number;
    Anims: GeosetAnimInfo[];
    MaterialID: number;
    SelectionGroup: number;
    Unselectable: boolean;
    LevelOfDetail?: number;
    Name?: string;
    Tangents?: Float32Array;
    SkinWeights?: Uint8Array;
}

declare interface GeosetAnim {
    GeosetId: number;
    Alpha: AnimVector | number;
    Color: AnimVector | Float32Array;
    Flags: number;
}

declare enum GeosetAnimFlags {
    DropShadow = 1,
    Color = 2
}

declare interface GeosetAnimInfo {
    MinimumExtent: Float32Array;
    MaximumExtent: Float32Array;
    BoundsRadius: number;
}

export declare function getBLPImageData(blp: BLPImage, mipmapLevel: number): ImageDataLike;

declare type Helper = Node_2;

declare interface ImageDataLike {
    width: number;
    height: number;
    data: ImageDataArray;
    colorSpace: 'srgb' | 'display-p3' | undefined;
}

declare interface Layer {
    FilterMode?: FilterMode;
    Shading?: number;
    TextureID?: AnimVector | number;
    TVertexAnimId?: number;
    CoordId: number;
    Alpha?: AnimVector | number;
    EmissiveGain?: AnimVector | number;
    FresnelColor?: AnimVector | Float32Array;
    FresnelOpacity?: AnimVector | number;
    FresnelTeamColor?: AnimVector | number;
    ShaderTypeId?: number;
    NormalTextureID?: AnimVector | number;
    ORMTextureID?: AnimVector | number;
    EmissiveTextureID?: AnimVector | number;
    TeamColorTextureID?: AnimVector | number;
    ReflectionsTextureID?: AnimVector | number;
}

/** GL blend factors [source RGB, destination RGB, source alpha, destination alpha] for a layer's filter mode; None draws without blending. */
export declare function layerBlendFactors(filterMode: FilterMode): [number, number, number, number] | null;

/** A layer fragment's alpha: its geoset's alpha times its own times the model's (an effect's alpha), whatever its filter mode. */
export declare function layerOpacity(geosetAlpha: number, layerAlpha: number, instanceAlpha: number): number;

declare enum LayerShading {
    Unshaded = 1,
    SphereEnvMap = 2,
    TwoSided = 16,
    Unfogged = 32,
    NoDepthTest = 64,
    NoDepthSet = 128
}

declare interface Light extends Node_2 {
    LightType: LightType;
    AttenuationStart?: AnimVector | number;
    AttenuationEnd?: AnimVector | number;
    Color?: AnimVector | Float32Array;
    Intensity?: AnimVector | number;
    AmbIntensity?: AnimVector | number;
    AmbColor?: AnimVector | Float32Array;
    Visibility?: AnimVector;
}

declare enum LightType {
    Omnidirectional = 0,
    Directional = 1,
    Ambient = 2
}

declare enum LineType {
    DontInterp = 0,
    Linear = 1,
    Hermite = 2,
    Bezier = 3
}

declare interface Material {
    PriorityPlane?: number;
    RenderMode?: number;
    Layers: Layer[];
    Shader?: string;
}

declare enum MaterialRenderMode {
    ConstantColor = 1,
    SortPrimsFarZ = 16,
    FullResolution = 32
}

declare interface Model {
    Version: number;
    Info: ModelInfo;
    Sequences: Sequence[];
    Textures: Texture[];
    Materials: Material[];
    Geosets: Geoset[];
    GeosetAnims: GeosetAnim[];
    Bones: Bone[];
    Helpers: Helper[];
    Attachments: Attachment[];
    Nodes: Node_2[];
    PivotPoints: Float32Array[];
    EventObjects: EventObject[];
    CollisionShapes: CollisionShape[];
    GlobalSequences: number[];
    ParticleEmitters: ParticleEmitter[];
    ParticleEmitters2: ParticleEmitter2[];
    Cameras: Camera[];
    Lights: Light[];
    RibbonEmitters: RibbonEmitter[];
    TextureAnims: TVertexAnim[];
    FaceFX?: FaceFX[];
    BindPoses?: BindPose[];
    ParticleEmitterPopcorns?: ParticleEmitterPopcorn[];
}

export declare namespace model {
    export {
        ModelInfo,
        Sequence,
        TextureFlags,
        Texture,
        FilterMode,
        LineType,
        AnimKeyframe,
        AnimVector,
        LayerShading,
        Layer,
        MaterialRenderMode,
        Material,
        GeosetAnimInfo,
        Geoset,
        GeosetAnimFlags,
        GeosetAnim,
        NodeFlags,
        NodeType,
        Node_2 as Node,
        Bone,
        Helper,
        Attachment,
        EventObject,
        CollisionShapeType,
        CollisionShape,
        ParticleEmitterFlags,
        ParticleEmitter,
        ParticleEmitter2Flags,
        ParticleEmitter2FilterMode,
        ParticleEmitter2FramesFlags,
        ParticleEmitter2,
        Camera,
        LightType,
        Light,
        RibbonEmitter,
        TVertexAnim,
        FaceFX,
        BindPose,
        ParticleEmitterPopcornFlags,
        ParticleEmitterPopcorn,
        Model
    }
}

declare interface ModelInfo {
    Name: string;
    MinimumExtent: Float32Array;
    MaximumExtent: Float32Array;
    BoundsRadius: number;
    BlendTime: number;
    NumGeosets?: number;
    NumGeosetAnims?: number;
    NumBones?: number;
    NumLights?: number;
    NumAttachments?: number;
    NumEvents?: number;
    NumParticleEmitters?: number;
    NumParticleEmitters2?: number;
    NumRibbonEmitters?: number;
}

export declare class ModelRenderer {
    private instanceAlpha;
    private isHD;
    private hasWeightedSkin;
    private canvas;
    private gl;
    private device;
    private gpuContext;
    private anisotropicExt;
    private colorBufferFloatExt;
    private vertexShader;
    private fragmentShader;
    private shaderProgram;
    private vsBindGroupLayout;
    private fsBindGroupLayout;
    private gpuShaderModule;
    private gpuDepthShaderModule;
    private gpuPipelines;
    private gpuWireframePipeline;
    private gpuShadowPipeline;
    private gpuPipelineLayout;
    private gpuRenderPassDescriptor;
    private shaderProgramLocations;
    private skeletonShaderProgram;
    private skeletonVertexShader;
    private skeletonFragmentShader;
    private skeletonShaderProgramLocations;
    private skeletonVertexBuffer;
    private skeletonColorBuffer;
    private skeletonShaderModule;
    private skeletonBindGroupLayout;
    private skeletonPipelineLayout;
    private skeletonPipeline;
    private skeletonGPUVertexBuffer;
    private skeletonGPUColorBuffer;
    private skeletonGPUUniformsBuffer;
    private model;
    private interp;
    private rendererData;
    private particlesController;
    private ribbonsController;
    private softwareSkinning;
    private vertexBuffer;
    private normalBuffer;
    private vertices;
    private texCoordBuffer;
    private indexBuffer;
    private wireframeIndexBuffer;
    private wireframeIndexGPUBuffer;
    private groupBuffer;
    private skinWeightBuffer;
    private tangentBuffer;
    private envShaderModeule;
    private envPiepeline;
    private envVSBindGroupLayout;
    private envFSBindGroupLayout;
    private envVSUniformsBuffer;
    private envVSBindGroup;
    private envSampler;
    private cubeVertexBuffer;
    private cubeGPUVertexBuffer;
    private squareVertexBuffer;
    private brdfLUT;
    private gpuBrdfLUT;
    private gpuBrdfSampler;
    private envToCubemap;
    private envToCubemapShaderModule;
    private envToCubemapPiepeline;
    private envToCubemapVSBindGroupLayout;
    private envToCubemapFSBindGroupLayout;
    private envToCubemapSampler;
    private envSphere;
    private convoluteDiffuseEnv;
    private convoluteDiffuseEnvShaderModule;
    private convoluteDiffuseEnvPiepeline;
    private convoluteDiffuseEnvVSBindGroupLayout;
    private convoluteDiffuseEnvFSBindGroupLayout;
    private convoluteDiffuseEnvSampler;
    private prefilterEnv;
    private prefilterEnvShaderModule;
    private prefilterEnvPiepeline;
    private prefilterEnvVSBindGroupLayout;
    private prefilterEnvFSBindGroupLayout;
    private prefilterEnvSampler;
    private integrateBRDF;
    private gpuMultisampleTexture;
    private gpuDepthTexture;
    private gpuVertexBuffer;
    private gpuNormalBuffer;
    private gpuTexCoordBuffer;
    private gpuGroupBuffer;
    private gpuIndexBuffer;
    private gpuSkinWeightBuffer;
    private gpuTangentBuffer;
    private gpuVSUniformsBuffer;
    private gpuVSUniformsBindGroup;
    private gpuFSUniformsBuffers;
    constructor(model: Model);
    destroy(): void;
    private initRequiredEnvMaps;
    initGL(glContext: WebGL2RenderingContext | WebGLRenderingContext): void;
    initGPUDevice(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext): Promise<void>;
    setTextureImage(path: string, img: HTMLImageElement): void;
    setTextureImageData(path: string, imageData: ImageData[]): void;
    setTextureCompressedImage(path: string, format: DDS_FORMAT, imageData: ArrayBuffer, ddsInfo: DdsInfo): void;
    setGPUTextureCompressedImage(path: string, format: GPUTextureFormat, imageData: ArrayBuffer, ddsInfo: DdsInfo): void;
    setCamera(cameraPos: vec3, cameraQuat: quat): void;
    /** Wisp: a directional key light and ambient fill, its direction in model space toward the light, and linear fog by eye depth. */
    setWispEnvironment(environment: {
        linearOutput?: boolean;
        light?: { direction: ArrayLike<number>; key: ArrayLike<number>; ambient: ArrayLike<number>; linear?: boolean; overbright?: boolean };
        fog?: { color: ArrayLike<number>; start: number; end: number; near: number; far: number; max: number; height?: { bottom: number; top: number; start: number; end: number; model?: Float32Array } };
        /** Up to eight omni lights in world space (colour times intensity, full to start, zero from end), with the draw's model and normal matrices. */
        points?: { model: ArrayLike<number>; normal: ArrayLike<number>; lights: readonly { position: ArrayLike<number>; color: ArrayLike<number>; start: number; end: number; shadowSlot?: number }[] };
        /** The sun's depth map (unit 7): model space to its clip space, depth bias and one texel in map coordinates; it darkens only the key light. */
        shadow?: { map: WebGLTexture; matrix: ArrayLike<number>; bias: number; texel: number };
        /** Omni-light depth maps (unit 8): a 3 × 4 atlas of cube faces, two lights of six faces; the six faces' matrices from light-relative world space; a light's `shadowSlot` (0 or 1) picks its six. */
        pointShadow?: { map: WebGLTexture; matrices: ArrayLike<number>; near: number; far: number; texel: number };
    } | undefined): void;
    setLightPosition(lightPos: vec3): void;
    setLightColor(lightColor: vec3): void;
    setSequence(index: number): void;
    getSequence(): number;
    setFrame(frame: number): void;
    getFrame(): number;
    setTeamColor(color: vec3): void;
    update(delta: number): void;
    render(mvMatrix: mat4, pMatrix: mat4, { wireframe, env, levelOfDetail, useEnvironmentMap, shadowMapTexture, shadowMapMatrix, shadowBias, shadowSmoothingStep, depthTextureTarget }: {
        wireframe?: boolean;
        env?: boolean;
        levelOfDetail?: number;
        useEnvironmentMap?: boolean;
        shadowMapTexture?: WebGLTexture | GPUTexture;
        shadowMapMatrix?: mat4;
        shadowBias?: number;
        shadowSmoothingStep?: number;
        depthTextureTarget?: GPUTexture;
    }): void;
    private renderEnvironmentGPU;
    private renderEnvironment;
    /**
     * @param mvMatrix
     * @param pMatrix
     * @param nodes Nodes to highlight. null means draw all
     */
    renderSkeleton(mvMatrix: mat4, pMatrix: mat4, nodes: string[] | null): void;
    private initSkeletonShaderProgram;
    private generateGeosetVertices;
    private setTextureParameters;
    private processEnvMaps;
    private initShaderProgram;
    private destroyShaderProgramObject;
    private initShaders;
    private initGPUShaders;
    private createWireframeBuffer;
    private createWireframeGPUBuffer;
    private initBuffers;
    private createGPUPipeline;
    private createGPUPipelineByLayer;
    private getGPUPipeline;
    private initGPUPipeline;
    private initGPUBuffers;
    private initGPUUniformBuffers;
    private initGPUMultisampleTexture;
    private initGPUDepthTexture;
    private initGPUEmptyTexture;
    private initCube;
    private initSquare;
    private initBRDFLUT;
    private initGPUBRDFLUT;
    private updateGlobalSequences;
    private updateNode;
    private findAlpha;
    private getTexCoordMatrix;
    /** A layer's opacity is its geoset's animated alpha times the layer's own animated alpha. */
    private setLayerAlpha;
    /** The whole model's opacity, as a game sets an effect's alpha. Particles and ribbons ignore it. */
    setInstanceAlpha(alpha: number): void;
    setInstanceColor(color: Float32Array): void;
    private setLayerProps;
    private setLayerPropsHD;
}

declare interface Node_2 {
    Name: string;
    ObjectId: number;
    Parent?: number | null;
    PivotPoint: Float32Array;
    Flags: number;
    Translation?: AnimVector;
    Rotation?: AnimVector;
    Scaling?: AnimVector;
}

declare enum NodeFlags {
    DontInheritTranslation = 1,
    DontInheritRotation = 2,
    DontInheritScaling = 4,
    Billboarded = 8,
    BillboardedLockX = 16,
    BillboardedLockY = 32,
    BillboardedLockZ = 64,
    CameraAnchored = 128
}

declare enum NodeType {
    Helper = 0,
    Bone = 256,
    Light = 512,
    EventObject = 1024,
    Attachment = 2048,
    ParticleEmitter = 4096,// ParticleEmitter | ParticleEmitter2 | ParticleEmitterPopcorn
    CollisionShape = 8192,
    RibbonEmitter = 16384
}

export declare function parseMDL(str: string): Model;

export declare function parseMDX(arrayBuffer: ArrayBuffer): Model;

declare interface ParticleEmitter extends Node_2 {
    EmissionRate: AnimVector | number;
    Gravity: AnimVector | number;
    Longitude: AnimVector | number;
    Latitude: AnimVector | number;
    Path: string;
    LifeSpan: AnimVector | number;
    InitVelocity: AnimVector | number;
    Visibility: AnimVector;
}

declare interface ParticleEmitter2 extends Node_2 {
    Speed?: AnimVector | number;
    Variation?: AnimVector | number;
    Latitude?: AnimVector | number;
    Gravity?: AnimVector | number;
    Visibility?: AnimVector | number;
    Squirt?: boolean;
    LifeSpan?: number;
    EmissionRate?: AnimVector | number;
    Width?: AnimVector | number;
    Length?: AnimVector | number;
    FilterMode?: ParticleEmitter2FilterMode;
    Rows?: number;
    Columns?: number;
    FrameFlags: number;
    TailLength?: number;
    Time?: number;
    SegmentColor?: Float32Array[];
    Alpha?: Uint8Array;
    ParticleScaling?: Float32Array;
    LifeSpanUVAnim?: Uint32Array;
    DecayUVAnim?: Uint32Array;
    TailUVAnim?: Uint32Array;
    TailDecayUVAnim?: Uint32Array;
    TextureID?: number;
    ReplaceableId?: number;
    PriorityPlane?: number;
}

declare enum ParticleEmitter2FilterMode {
    Blend = 0,
    Additive = 1,
    Modulate = 2,
    Modulate2x = 3,
    AlphaKey = 4
}

declare enum ParticleEmitter2Flags {
    Unshaded = 32768,
    SortPrimsFarZ = 65536,
    LineEmitter = 131072,
    Unfogged = 262144,
    ModelSpace = 524288,
    XYQuad = 1048576
}

declare enum ParticleEmitter2FramesFlags {
    Head = 1,
    Tail = 2
}

declare enum ParticleEmitterFlags {
    EmitterUsesMDL = 32768,
    EmitterUsesTGA = 65536
}

declare interface ParticleEmitterPopcorn extends Node_2 {
    LifeSpan?: AnimVector | number;
    EmissionRate?: AnimVector | number;
    Speed?: AnimVector | number;
    Color?: AnimVector | Float32Array;
    Alpha?: AnimVector | number;
    ReplaceableId?: number;
    Path?: string;
    AnimVisibilityGuide?: string;
    Visibility?: AnimVector;
}

declare enum ParticleEmitterPopcornFlags {
    Unshaded = 32768,
    SortPrimsFarZ = 65536,
    Unfogged = 262144
}

declare interface RibbonEmitter extends Node_2 {
    HeightAbove?: AnimVector | number;
    HeightBelow?: AnimVector | number;
    Alpha?: AnimVector | number;
    Color?: Float32Array;
    LifeSpan?: number;
    TextureSlot?: AnimVector | number;
    EmissionRate?: number;
    Rows?: number;
    Columns?: number;
    MaterialID?: number;
    Gravity?: number;
    Visibility?: AnimVector;
}

declare interface Sequence {
    Name: string;
    Interval: Uint32Array;
    NonLooping: boolean;
    MinimumExtent: Float32Array;
    MaximumExtent: Float32Array;
    BoundsRadius: number;
    MoveSpeed: number;
    Rarity: number;
}

declare interface Texture {
    Image: string;
    ReplaceableId?: number;
    Flags?: TextureFlags;
}

declare enum TextureFlags {
    WrapWidth = 1,
    WrapHeight = 2
}

declare interface TVertexAnim {
    Translation?: AnimVector;
    Rotation?: AnimVector;
    Scaling?: AnimVector;
}

export { }
