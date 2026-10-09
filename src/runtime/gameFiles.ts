// Names and wire formats shared by Warcraft map code and Wisp host tools.

/** FileIO stores one chunk per tooltip level of its ability. */
export const CHUNKS_PER_FILE = 64;
/**
 * Bundle bytes per payload file. The file is raw Lua that stores them in one
 * tooltip; a 200,000-character tooltip read back intact in the game.
 */
export const PAYLOAD_FILE_BYTES = 200_000;
/** The FileIO ability ('$wsl') whose tooltips carry text from host files. */
export const FILE_IO_ABILITY = 0x2477736c;
/** Player slots that write their own copy of a per-slot file. */
export const FILE_SLOTS = 4;

// Preloader checks whether a file exists on every call but runs the content it
// first read from that path for the rest of the Warcraft session. So no name is reused for
// other content: manifests are numbered by a version that only rises and are never
// removed, and payload files are named by the module state they carry.
//
// Manifests and payloads live in their own CustomMapData folder, which every
// client polls for a manifest that doesn't exist yet. Wine looks up a missing
// name by reading the folder that should hold it, or its parent when that
// folder is missing too: a small hot folder keeps each poll cheap, while a
// missing one costs a read of all of CustomMapData (32-35 ms for 94,057 files).
// The host creates the folder with its marker before any match or reload, and
// a map that has seen neither looks only twice a second.
// Paths are as the game passes them, relative to CustomMapData.
export const hotFolder = (prefix = "wisp") => `${prefix}-hot`;
/** The host's marker: it exists only in a folder a host created, and its content never changes. */
export const hostFile = (prefix = "wisp") => `${hotFolder(prefix)}\\host.pld`;
export const manifestFile = (version: number, prefix = "wisp") => `${hotFolder(prefix)}\\manifest-${version}.pld`;
/** Names a checksum in file names and as a Lua chunk name, which error positions carry. */
export const payloadKey = (payloadChecksum: string) => payloadChecksum.replace(":", "-");
/** A file of a version's full payload, named by the version's module state (wisp:src/runtime/modules.ts). */
export const payloadFile = (state: string, index: number, prefix = "wisp") => `${hotFolder(prefix)}\\${payloadKey(state)}-${index}.pld`;
/** A file of a version's delta: the modules its state has and `base` lacks. */
export const deltaFile = (state: string, base: string, index: number, prefix = "wisp") => `${hotFolder(prefix)}\\${payloadKey(state)}-${payloadKey(base)}-${index}.pld`;
export const ackFile = (slot: number, prefix = "wisp") => `${prefix}-hot-ack-p${slot}.txt`;
export const errorFile = (slot: number, prefix = "wisp") => `${prefix}-error-p${slot}.txt`;
export const modelFailureRequestFile = (slot: number, prefix = "wisp") => `${prefix}-model-load-p${slot}.txt`;
export const modelFailureTokenFile = (slot: number, ordinal: number, prefix = "wisp") => `${hotFolder(prefix)}\\model-load-token-p${slot}-${ordinal}.pld`;
export const modelFailureFile = (token: string, ordinal: number, prefix = "wisp") => `${hotFolder(prefix)}\\model-load-${token}-${ordinal}.pld`;

/** The manifest's base when a version offers no delta. */
export const NO_BASE = "-";

export interface Manifest {
  version: number;
  /** The checksum of the version's module index, which names its state. */
  state: string;
  /** Files of the full payload. */
  files: number;
  /** The state the delta applies to, or NO_BASE. */
  base: string;
  /** Files of the delta; 0 without one. */
  changes: number;
}

/** One line, which is also the start of every client's synchronized answer. */
export const formatManifest = ({ version, state, files, base, changes }: Manifest) => `${version} ${state} ${files} ${base} ${changes}`;

export function parseManifest(text: string): Manifest | undefined {
  const [versionText, state, filesText, base, changesText] = text.split(" ");
  const version = Number(versionText);
  const files = Number(filesText);
  const changes = Number(changesText);
  // Comparisons are false for NaN, which rejects non-numeric fields.
  if (!(version >= 1) || !(files >= 1) || !(changes >= 0) || state === undefined || base === undefined) return undefined;
  if ((base === NO_BASE) !== (changes === 0)) return undefined;
  return { version, state, files, base, changes };
}

/** The acknowledgement: the version every client installed, at the reloader's game time in seconds. */
export const acknowledgementLine = (version: number, elapsed: number) => `applied ${version} at ${elapsed}`;
/** An error report's first line; the message and each stack line follow, one line each. */
export const errorHeading = (count: number, handler: string) => `error ${count} in ${handler}`;
