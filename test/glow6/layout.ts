export const GLOW = "war3mapImported\\Wisp6Glow.mdx";
export const TWIN = "war3mapImported\\Wisp6Twin.mdx";
export const BOARD = "war3mapImported\\Wisp6Board.mdx";
export const TWIN_TEXTURE = "war3mapImported\\Wisp6Twin.blp";
export const BLACK_TEXTURE = "war3mapImported\\Wisp6Black.blp";


/** Looking 15 degrees off straight down, so screen up is world +y in both Warcraft and Wisp rather than whatever a vertical view's degenerate up vector gives. */
export const CAMERA = { x: 0, y: 0, distance: 1650, fieldOfView: 70, angleOfAttack: 285 };

/** Half the quad's side in world units, so it spans about 256 px at 1920x1080 with this camera. */
export const QUAD_HALF = 152;

/** The quad's centre height, so its tilted lower edge stays above the board. */
export const QUAD_Z = 60;

/** The quad leans toward the camera by as much as the camera leans off vertical, so it faces the eye squarely. */
export const QUAD_TILT = (CAMERA.angleOfAttack - 270) * Math.PI / 180;

/** The quad's corners as x, y, z, u, v: lower left, lower right, upper right, upper left as the camera sees it, v = 0 along the top. */
export const QUAD_CORNERS: readonly (readonly [number, number, number, number, number])[] = ([[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, 1, 0, 0]] as const).map(([sx, sy, u, v]) =>
  [sx * QUAD_HALF, sy * QUAD_HALF * Math.cos(QUAD_TILT), QUAD_Z + sy * QUAD_HALF * Math.sin(QUAD_TILT), u, v] as const);

export const BOARD_HALF = 4000;

/** The board lies this high above the ground, below the quad's lowest corner. */
export const BOARD_Z = 4;

/** Where a quad waits while not shown: on the board, far outside the view. */
export const HIDDEN_Y = -3000;

export const TEXTURE_SIZE = 32;

export const START_SECONDS = 3;

export const PHASE_SECONDS = 12;

export const PHASES = ["glow", "twin", "hidden"] as const;
export type Phase = (typeof PHASES)[number];

export const STATUS_FILE = "glow6-p0.txt";

/** The frame at which the headless oracle reads the glow phase's scene, mid-way through it; the twin phase is read one phase later. */
export const ORACLE_FRAME = (START_SECONDS + PHASE_SECONDS / 2) * 60;
