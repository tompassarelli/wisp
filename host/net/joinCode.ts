const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_HASH_DIGITS = 8;

export interface JoinTarget {
  readonly address: string;
  readonly port: number;
  readonly mapHash?: string;
}

/** A join code: the host's IPv4 address, its UDP port and the first 8 hex digits of the map's hash, in 16 Crockford base-32 letters. */
export function joinCode(address: string, port: number, mapHash: string): string {
  const parts = address.split(".").map(Number);
  const hash = mapHash.slice(0, CODE_HASH_DIGITS);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) throw new Error(`join codes carry an IPv4 address, not ${address}`);
  if (!/^[0-9a-f]{8}$/.test(hash)) throw new Error(`the map hash needs at least 8 hex digits, not ${mapHash}`);
  const bytes = [...parts, port >> 8, port & 255, ...hash.match(/../g)!.map((pair) => parseInt(pair, 16))];
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let text = "";
  for (let index = 15; index >= 0; index--) text += ALPHABET[Number((bits >> BigInt(index * 5)) & 31n)];
  return text.match(/..../g)!.join("-");
}

/** `ADDRESS:PORT` joins directly; anything else is read as a join code (case, dashes, O for 0 and I or L for 1 forgiven). */
export function joinTarget(text: string): JoinTarget | string {
  const direct = /^(.+):(\d{1,5})$/.exec(text);
  if (direct !== null) return { address: direct[1] ?? "", port: Number(direct[2]) };
  const letters = text.toUpperCase().replaceAll("-", "").replaceAll("O", "0").replace(/[IL]/g, "1");
  if (letters.length !== 16 || [...letters].some((letter) => !ALPHABET.includes(letter))) return `${text} is neither a join code (16 letters) nor ADDRESS:PORT`;
  let bits = 0n;
  for (const letter of letters) bits = (bits << 5n) | BigInt(ALPHABET.indexOf(letter));
  const bytes = Array.from({ length: 10 }, (_, index) => Number((bits >> BigInt((9 - index) * 8)) & 255n));
  return {
    address: bytes.slice(0, 4).join("."),
    port: ((bytes[4] ?? 0) << 8) | (bytes[5] ?? 0),
    mapHash: bytes.slice(6).map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}
