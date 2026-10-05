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
// removed, and payload files are named by their bundle's checksum.
export const manifestFile = (version: number, prefix = "wisp") => `${prefix}-hot-manifest-${version}.pld`;
/** Names a bundle in file names and as its Lua chunk name, which error positions carry. */
export const payloadKey = (payloadChecksum: string) => payloadChecksum.replace(":", "-");
export const payloadFile = (payloadChecksum: string, index: number, prefix = "wisp") => `${prefix}-hot-${payloadKey(payloadChecksum)}-${index}.pld`;
export const ackFile = (slot: number, prefix = "wisp") => `${prefix}-hot-ack-p${slot}.txt`;
export const errorFile = (slot: number, prefix = "wisp") => `${prefix}-error-p${slot}.txt`;
export interface Manifest {
  version: number;
  files: number;
  checksum: string;
}

export const formatManifest = ({ version, files, checksum }: Manifest) => `${version} ${files} ${checksum}`;

export function parseManifest(text: string): Manifest | undefined {
  const [versionText, filesText, checksum] = text.split(" ");
  const version = Number(versionText);
  const files = Number(filesText);
  // Comparisons are false for NaN, which rejects non-numeric fields.
  if (!(version >= 1) || !(files >= 1) || checksum === undefined) return undefined;
  return { version, files, checksum };
}

/** The acknowledgement: the version every client installed, at the reloader's game time in seconds. */
export const acknowledgementLine = (version: number, elapsed: number) => `applied ${version} at ${elapsed}`;
/** An error report's first line; the message and each stack line follow, one line each. */
export const errorHeading = (count: number, handler: string) => `error ${count} in ${handler}`;
