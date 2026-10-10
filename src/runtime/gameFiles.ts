export const CHUNKS_PER_FILE = 64;
// Payload tooltip capacity is based on a 200,000-character native round trip.

export const PAYLOAD_FILE_BYTES = 200_000;

export const FILE_IO_ABILITY = 0x2477736c;

export const FILE_SLOTS = 4;

// Preloader caches each path's first content for the session; never reuse a name for different bytes.

// Wine scans the parent of a missing Preloader path; keep polling in a dedicated hot folder.

export const hotFolder = (prefix = "wisp") => `${prefix}-hot`;

export const hostFile = (prefix = "wisp") => `${hotFolder(prefix)}\\host.pld`;
export const manifestFile = (version: number, prefix = "wisp") => `${hotFolder(prefix)}\\manifest-${version}.pld`;

export const payloadKey = (payloadChecksum: string) => payloadChecksum.replace(":", "-");

export const payloadFile = (state: string, index: number, prefix = "wisp") => `${hotFolder(prefix)}\\${payloadKey(state)}-${index}.pld`;

export const deltaFile = (state: string, base: string, index: number, prefix = "wisp") => `${hotFolder(prefix)}\\${payloadKey(state)}-${payloadKey(base)}-${index}.pld`;
export const ackFile = (slot: number, prefix = "wisp") => `${prefix}-hot-ack-p${slot}.txt`;
export const errorFile = (slot: number, prefix = "wisp") => `${prefix}-error-p${slot}.txt`;
export const modelFailureRequestFile = (slot: number, prefix = "wisp") => `${prefix}-model-load-p${slot}.txt`;
export const modelFailureTokenFile = (slot: number, ordinal: number, prefix = "wisp") => `${hotFolder(prefix)}\\model-load-token-p${slot}-${ordinal}.pld`;
export const modelFailureFile = (token: string, ordinal: number, prefix = "wisp") => `${hotFolder(prefix)}\\model-load-${token}-${ordinal}.pld`;

export const NO_BASE = "-";

export interface Manifest {
  version: number;

  state: string;

  files: number;

  base: string;

  changes: number;
}

export const formatManifest = ({ version, state, files, base, changes }: Manifest) => `${version} ${state} ${files} ${base} ${changes}`;

export function parseManifest(text: string): Manifest | undefined {
  const [versionText, state, filesText, base, changesText] = text.split(" ");
  const version = Number(versionText);
  const files = Number(filesText);
  const changes = Number(changesText);

  if (!(version >= 1) || !(files >= 1) || !(changes >= 0) || state === undefined || base === undefined) return undefined;
  if ((base === NO_BASE) !== (changes === 0)) return undefined;
  return { version, state, files, base, changes };
}

export const acknowledgementLine = (version: number, elapsed: number) => `applied ${version} at ${elapsed}`;

export const errorHeading = (count: number, handler: string) => `error ${count} in ${handler}`;
