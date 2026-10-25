import { f32 } from "../../src/sim/f32";

export const BODY_ON = "war3mapImported\\Wisp6EBodyOn.mdx";
export const BODY_OFF = "war3mapImported\\Wisp6EBodyOff.mdx";
export const TWIN = "war3mapImported\\Wisp6ETwin.mdx";
export const FLOOR = "war3mapImported\\Wisp6EFloor.mdx";
export const WALL = "war3mapImported\\Wisp6EWall.mdx";
export const TWIN_TEXTURE = "war3mapImported\\Wisp6ETwin.blp";
export const BLACK_TEXTURE = "war3mapImported\\Wisp6EBlack.blp";

export const REPLICAS = ["planes", "flat", "all"] as const;
export type Replica = (typeof REPLICAS)[number];
export const replicaPath = (replica: Replica, frame: number) => `war3mapImported\\Wisp6E-${replica}-${frame}.mdx`;

export interface View { readonly x: number; readonly y: number; readonly distance: number; readonly zOffset: number; readonly fieldOfView: number; readonly angleOfAttack: number }
export interface Shot { readonly frame: number; readonly camera: View; readonly body: { readonly x: number; readonly y: number; readonly z: number; readonly seconds: number } }

/** W2's Warden forward-air frames as the W2-flat headless scenes record them: Smashcraft's follow camera and fighter slot 0's place and timeline time. */
export const SHOTS: readonly Shot[] = [
  { frame: 57, camera: { x: f32(0.24088927102629953), y: 0, distance: f32(845.1731562503847), zOffset: f32(1868.923779928034), fieldOfView: f32(62.91673278808594), angleOfAttack: 350 }, body: { x: -237, y: 0, z: f32(1849.199951171875), seconds: f32(244.80233764648438) } },
  { frame: 58, camera: { x: f32(0.38522680438414314), y: 0, distance: f32(846.2255013642645), zOffset: f32(1869.9942585247684), fieldOfView: f32(62.91952896118164), angleOfAttack: 350 }, body: { x: f32(-236.40000915527344), y: 0, z: f32(1854.9000244140625), seconds: f32(244.81900024414062) } },
  { frame: 60, camera: { x: f32(0.7258186340332031), y: 0, distance: f32(838.3357543945312), zOffset: f32(1871.176528930664), fieldOfView: f32(62.92430114746094), angleOfAttack: 350 }, body: { x: f32(-235.55999755859375), y: 0, z: f32(1862.1600341796875), seconds: f32(244.85232543945312) } },
  { frame: 61, camera: { x: f32(0.8710945844650269), y: 0, distance: f32(847.8262939453125), zOffset: f32(1872.8020324707031), fieldOfView: f32(62.926334381103516), angleOfAttack: 350 }, body: { x: f32(-235.31997680664062), y: 0, z: f32(1863.719970703125), seconds: f32(244.86900329589844) } },
];

const SMASHCRAFT = SHOTS[0]?.camera ?? { x: 0, y: 0, distance: 845, zOffset: 1869, fieldOfView: 63, angleOfAttack: 350 };

/** C1's camera, so the projection sweep ties back to C1's 169.6 px. */
export const C1_CAMERA: View = { x: 0, y: 0, distance: 1650, zOffset: 0, fieldOfView: 70, angleOfAttack: 285 };

export interface Placed { readonly model: string; readonly x: number; readonly y: number; readonly z: number; readonly seconds?: number }
export interface Phase { readonly name: string; readonly camera: View; readonly shown: readonly Placed[] }

const at = (shot: Shot, model: string, seconds?: number): Placed => ({ model, x: shot.body.x, y: shot.body.y, z: shot.body.z, ...(seconds === undefined ? {} : { seconds }) });
const target = (view: View, lift = 0): Placed => ({ model: TWIN, x: view.x, y: view.y, z: view.zOffset + lift });
const tilted = (angleOfAttack: number): View => ({ ...SMASHCRAFT, angleOfAttack });

/** Where the off-centre twin sits: about where W57's glow planes draw, in front of the fighter's right hand. */
export const OFF_CENTRE = { x: -240, y: -70, z: f32(1915.5) };

export const PHASES: readonly Phase[] = [
  { name: "hidden-s", camera: SMASHCRAFT, shown: [] },
  ...SHOTS.flatMap((shot) => [
    ...REPLICAS.map((replica) => ({ name: `${replica}-${shot.frame}`, camera: shot.camera, shown: [at(shot, replicaPath(replica, shot.frame))] })),
    { name: `on-${shot.frame}`, camera: shot.camera, shown: [at(shot, BODY_ON, shot.body.seconds)] },
    { name: `off-${shot.frame}`, camera: shot.camera, shown: [at(shot, BODY_OFF, shot.body.seconds)] },
  ]),
  { name: "twin-s-centre", camera: SMASHCRAFT, shown: [target(SMASHCRAFT)] },
  { name: "twin-s-off", camera: SMASHCRAFT, shown: [{ model: TWIN, ...OFF_CENTRE }] },
  { name: "hidden-s-end", camera: SMASHCRAFT, shown: [] },
  ...[330, 310, 285].flatMap((angle) => [
    { name: `twin-a${angle}`, camera: tilted(angle), shown: [target(tilted(angle))] },
    { name: `hidden-a${angle}`, camera: tilted(angle), shown: [] },
  ]),
  { name: "twin-c1", camera: C1_CAMERA, shown: [target(C1_CAMERA, 60)] },
  { name: "hidden-c1", camera: C1_CAMERA, shown: [] },
];

/** Half the twin's side in world units. */
export const TWIN_HALF = 40;
export const FLOOR_HALF = 6000;
export const FLOOR_Z = 4;
/** The wall stands behind the fighter, facing the camera, so Smashcraft's near-level view sees black. */
export const WALL_Y = 600;
export const WALL_HALF = 6000;
export const WALL_TOP = 6000;
/** Where an effect waits while not shown: behind every phase's camera. */
export const HIDDEN = { x: 0, y: -9000, z: 0 };

export const START_SECONDS = 3;
export const PHASE_SECONDS = 6;
export const STATUS_FILE = "glow6e-p0.txt";
export const FAR_Z = 16000;
/** How often a shown body's timeline time is set again, as Smashcraft sets its fighters' time every frame: native didn't hold a time set once while the effect stood out of view. */
export const HOLD_SECONDS = f32(0.03125);
