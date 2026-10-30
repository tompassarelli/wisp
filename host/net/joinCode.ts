import type { Endpoint } from "./link";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_HASH_DIGITS = 8;
const ROOM_LETTERS = 13;
const REGION_NAME = /^[a-z][a-z0-9]{1,7}$/;

export type JoinTarget =
  | { readonly address: string; readonly port: number; readonly mapHash?: string }
  | { readonly relay: Endpoint; readonly room: bigint };

/** A relay region's name and address. */
export type RelayRegions = ReadonlyMap<string, Endpoint>;

/** The published list: Nexus, DigitalOcean sgp1 in Singapore (wisp:docs/relay.md, "Where the relay runs"). */
const PUBLISHED_REGIONS: readonly (readonly [string, Endpoint])[] = [["sgp", { address: "159.89.205.60", port: 7457 }]];

/** The published list; `WISP_RELAYS` ("sgp=203.0.113.9:7457,eu=...") adds to it or replaces a name in it. */
export function relayRegions(env: Readonly<Record<string, string | undefined>> = process.env): RelayRegions {
  const regions = new Map<string, Endpoint>(PUBLISHED_REGIONS);
  for (const entry of (env["WISP_RELAYS"] ?? "").split(",")) {
    const match = /^([a-z][a-z0-9]{1,7})=(.+):(\d{1,5})$/.exec(entry.trim());
    if (match !== null) regions.set(match[1] ?? "", { address: match[2] ?? "", port: Number(match[3]) });
  }
  return regions;
}

function normalize(text: string): string {
  return text.toUpperCase().replaceAll("-", "").replaceAll("O", "0").replace(/[IL]/g, "1");
}

const grouped = (letters: string) => letters.match(/.{1,4}/g)!.join("-");

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
  return grouped(text);
}

export interface RelayChoice {
  readonly name: string | undefined;
  readonly relay: Endpoint;
}

/** What `--relay` names: a region of the list, or a relay's `ADDRESS:PORT`. */
export function relayChoice(text: string, regions: RelayRegions): RelayChoice | string {
  const direct = /^(.+):(\d{1,5})$/.exec(text);
  if (direct !== null) return { name: undefined, relay: { address: direct[1] ?? "", port: Number(direct[2]) } };
  const relay = regions.get(text.toLowerCase());
  return relay === undefined ? `${text} is no relay region (${[...regions.keys()].join(", ") || "none listed"}) and not a relay ADDRESS:PORT` : { name: text.toLowerCase(), relay };
}

/** A relayed match's code: the region and the room (`sgp-7K2M-QX9D-R3TB-4`), or `ADDRESS:PORT/ROOM` for a relay outside the region list. */
export function relayCode(choice: RelayChoice, room: bigint): string {
  let letters = "";
  for (let index = ROOM_LETTERS - 1; index >= 0; index--) letters += ALPHABET[Number((room >> BigInt(index * 5)) & 31n)];
  const text = grouped(letters);
  return choice.name === undefined ? `${choice.relay.address}:${choice.relay.port}/${text}` : `${choice.name}-${text}`;
}

function roomOf(text: string): bigint | undefined {
  const letters = normalize(text);
  if (letters.length !== ROOM_LETTERS || [...letters].some((letter) => !ALPHABET.includes(letter))) return undefined;
  let room = 0n;
  for (const letter of letters) room = (room << 5n) | BigInt(ALPHABET.indexOf(letter));
  return room < 1n << 64n ? room : undefined;
}

/** `ADDRESS:PORT/ROOM` or `REGION-ROOM` reaches a relay's room; undefined when the text is neither. */
function relayTarget(text: string, regions: RelayRegions): JoinTarget | string | undefined {
  const through = /^(.+:\d{1,5})\/(.+)$/.exec(text);
  if (through !== null) {
    const choice = relayChoice(through[1] ?? "", regions);
    if (typeof choice === "string") return choice;
    const room = roomOf(through[2] ?? "");
    return room === undefined ? `${text} has no room code after the relay's address` : { relay: choice.relay, room };
  }
  const dash = text.indexOf("-");
  const room = dash > 0 && REGION_NAME.test(text.slice(0, dash).toLowerCase()) ? roomOf(text.slice(dash + 1)) : undefined;
  if (room === undefined) return undefined;
  const choice = relayChoice(text.slice(0, dash), regions);
  return typeof choice === "string" ? choice : { relay: choice.relay, room };
}

function lanTarget(text: string): JoinTarget | string {
  const letters = normalize(text);
  if (letters.length !== 16 || [...letters].some((letter) => !ALPHABET.includes(letter))) return `${text} is neither a join code (16 letters), a relay code (REGION-ROOM) nor ADDRESS:PORT`;
  let bits = 0n;
  for (const letter of letters) bits = (bits << 5n) | BigInt(ALPHABET.indexOf(letter));
  const bytes = Array.from({ length: 10 }, (_, index) => Number((bits >> BigInt((9 - index) * 8)) & 255n));
  return {
    address: bytes.slice(0, 4).join("."),
    port: ((bytes[4] ?? 0) << 8) | (bytes[5] ?? 0),
    mapHash: bytes.slice(6).map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

/** A relay code reaches a relay's room; `ADDRESS:PORT` joins directly; anything else is read as a join code (case, dashes, O for 0 and I or L for 1 forgiven). */
export function joinTarget(text: string, regions: RelayRegions = relayRegions()): JoinTarget | string {
  const relay = relayTarget(text, regions);
  if (relay !== undefined) return relay;
  const direct = /^(.+):(\d{1,5})$/.exec(text);
  return direct === null ? lanTarget(text) : { address: direct[1] ?? "", port: Number(direct[2]) };
}
