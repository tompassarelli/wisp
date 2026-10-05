// The map description (war3map.w3i), the map file header and the Lua config()
// that declares the same players, all derived from the supplied map
// declaration. The base map's terrain, camera and environment settings pass
// through unchanged.
import { longBrackets } from "./lua";

/** Every slot is a human-race user; every force is allied with allied victory and shared vision. */
export interface MapDeclaration {
  readonly author: string;
  readonly description: string;
  readonly suggestedPlayers: string;
  readonly players: readonly { readonly id: number; readonly name: string }[];
  readonly forces: readonly { readonly name: string; readonly playerIds: readonly number[] }[];
}

interface PlayerRecord {
  readonly id: number;
  readonly controller: number;
  readonly race: number;
  readonly raceSkin: number;
  readonly fixedStart: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  /** Ally low, ally high, enemy low and enemy high start-location priority masks. */
  readonly priorities: readonly [number, number, number, number];
}

interface ForceRecord {
  readonly flags: number;
  readonly playerMask: number;
  readonly name: string;
}

export interface MapInfo {
  /** Format, save count, editor and game versions. */
  readonly versions: Uint8Array;
  readonly name: string;
  readonly author: string;
  readonly description: string;
  readonly suggestedPlayers: string;
  /** Camera bounds and margins, then playable width and height. */
  readonly bounds: Uint8Array;
  readonly flags: number;
  /** Tileset through water settings, kept verbatim from the base map. */
  readonly environment: Uint8Array;
  readonly players: readonly PlayerRecord[];
  readonly forces: readonly ForceRecord[];
  /** Upgrade, tech and random unit and item tables. */
  readonly tables: Uint8Array;
}

const FORMAT = 39;
const USER = 1;
const HUMAN = 1;
const USE_CUSTOM_FORCES = 0x40;
const ALLIED = 0x1;
const ALLIED_VICTORY = 0x2;
const SHARED_VISION = 0x4;

type Field = "byte" | "int" | "string";
/** Format 39's fields from the tileset through the water settings. */
const ENVIRONMENT: readonly [Field, number][] = [
  ["byte", 1], // Tileset.
  ["int", 2], // Loading screen background and crest.
  ["string", 4], // Loading screen model, text, title and subtitle.
  ["int", 1], // Game data set.
  ["string", 4], // Prologue path, text, title and subtitle.
  ["int", 7], // Fog type, start, end, density and color; terrain fog style and sky.
  ["int", 4], // Terrain fog linear start, end, maximum opacity and height.
  ["int", 1], // Global weather.
  ["string", 1], // Sound environment.
  ["byte", 1], // Light environment tileset.
  ["int", 1], // Water color.
  ["int", 3], // Script language, graphics modes and game data version.
  ["int", 3], // Forced default, maximum and minimum camera zoom.
  ["int", 10], // Water opacity, reflection, emission, edges, waves and colors.
];

interface Cursor {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  offset: number;
}

function take(cursor: Cursor, length: number): Uint8Array {
  if (cursor.offset + length > cursor.bytes.length) throw new Error("truncated war3map.w3i");
  const slice = cursor.bytes.subarray(cursor.offset, cursor.offset + length);
  cursor.offset += length;
  return slice;
}

function int32(cursor: Cursor): number {
  const offset = cursor.offset;
  take(cursor, 4);
  return cursor.view.getInt32(offset, true);
}

function float32(cursor: Cursor): number {
  const offset = cursor.offset;
  take(cursor, 4);
  return cursor.view.getFloat32(offset, true);
}

function string(cursor: Cursor): string {
  const end = cursor.bytes.indexOf(0, cursor.offset);
  if (end < 0) throw new Error("unterminated string in war3map.w3i");
  const text = new TextDecoder().decode(cursor.bytes.subarray(cursor.offset, end));
  cursor.offset = end + 1;
  return text;
}

export function decodeMapInfo(bytes: Uint8Array): MapInfo {
  const cursor: Cursor = { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 };
  const format = int32(cursor);
  if (format !== FORMAT) throw new Error(`war3map.w3i format ${format} is not supported; expected ${FORMAT}`);
  cursor.offset = 0;
  const versions = take(cursor, 28);
  const [name, author, description, suggestedPlayers] = [string(cursor), string(cursor), string(cursor), string(cursor)];
  const bounds = take(cursor, 56);
  const flags = int32(cursor);
  const environmentStart = cursor.offset;
  for (const [field, count] of ENVIRONMENT) {
    for (let index = 0; index < count; index++) {
      if (field === "string") string(cursor);
      else take(cursor, field === "byte" ? 1 : 4);
    }
  }
  const environment = bytes.subarray(environmentStart, cursor.offset);
  const players = Array.from({ length: int32(cursor) }, (): PlayerRecord => ({
    id: int32(cursor),
    controller: int32(cursor),
    race: int32(cursor),
    raceSkin: int32(cursor),
    fixedStart: int32(cursor),
    name: string(cursor),
    x: float32(cursor),
    y: float32(cursor),
    priorities: [int32(cursor), int32(cursor), int32(cursor), int32(cursor)],
  }));
  const forces = Array.from({ length: int32(cursor) }, (): ForceRecord => ({
    flags: int32(cursor),
    playerMask: int32(cursor),
    name: string(cursor),
  }));
  return { versions, name, author, description, suggestedPlayers, bounds, flags, environment, players, forces, tables: bytes.subarray(cursor.offset) };
}

function int32Bytes(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
}

function float32Bytes(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return bytes;
}

function stringBytes(text: string): Uint8Array {
  return new TextEncoder().encode(`${text}\0`);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

export function encodeMapInfo(info: MapInfo): Uint8Array {
  return concat([
    info.versions,
    ...[info.name, info.author, info.description, info.suggestedPlayers].map(stringBytes),
    info.bounds,
    int32Bytes(info.flags),
    info.environment,
    int32Bytes(info.players.length),
    ...info.players.flatMap((player) => [
      ...[player.id, player.controller, player.race, player.raceSkin, player.fixedStart].map(int32Bytes),
      stringBytes(player.name),
      float32Bytes(player.x),
      float32Bytes(player.y),
      ...player.priorities.map(int32Bytes),
    ]),
    int32Bytes(info.forces.length),
    ...info.forces.flatMap((force) => [int32Bytes(force.flags), int32Bytes(force.playerMask), stringBytes(force.name)]),
    info.tables,
  ]);
}

/**
 * The base map's description with the declared name, players and forces. A
 * declared slot that the base map already has keeps its start location, race
 * skin and priorities declared by the map configuration.
 */
export function declareMap(base: MapInfo, name: string, map: MapDeclaration): MapInfo {
  return {
    ...base,
    name,
    author: map.author,
    description: map.description,
    suggestedPlayers: map.suggestedPlayers,
    flags: base.flags | USE_CUSTOM_FORCES,
    players: map.players.map(({ id, name: playerName }) => {
      const existing = base.players.find((player) => player.id === id);
      return {
        id,
        controller: USER,
        race: HUMAN,
        raceSkin: existing?.raceSkin ?? 0,
        fixedStart: existing?.fixedStart ?? 0,
        name: playerName,
        x: existing?.x ?? 0,
        y: existing?.y ?? 0,
        priorities: existing?.priorities ?? [0, 0, 0, 0],
      };
    }),
    forces: map.forces.map((force) => ({
      flags: ALLIED | ALLIED_VICTORY | SHARED_VISION,
      playerMask: force.playerIds.reduce((mask, id) => mask | (1 << id), 0),
      name: force.name,
    })),
  };
}

/** The 512-byte header in front of the archive, which map lists read. */
export function mapHeader(info: MapInfo): Uint8Array {
  const header = new Uint8Array(512);
  const fields = concat([new TextEncoder().encode("HM3W"), int32Bytes(0), stringBytes(info.name), int32Bytes(info.flags), int32Bytes(info.players.length)]);
  if (fields.length > header.length) throw new Error("map name does not fit the map header");
  header.set(fields);
  return header;
}

function luaString(text: string): string {
  const [open, close] = longBrackets(text);
  // Lua drops a newline right after an opening long bracket.
  return text.startsWith("\n") ? `${open}\n${text}${close}` : `${open}${text}${close}`;
}

function luaReal(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

/**
 * `function mapConfig()`: the Lua config generated for this
 * description (InitCustomPlayerSlots, InitCustomTeams and
 * InitAllyPriorities).
 */
export function mapConfig(info: MapInfo): string {
  if (info.players.some((player) => player.controller !== USER || player.race !== HUMAN)) {
    throw new Error("map config supports only human-race user slots");
  }
  if (info.players.some((player) => player.priorities.some((mask) => mask !== 0))) {
    throw new Error("map config does not support start-location priorities");
  }
  const player = (id: number) => `Player(${id})`;
  const lines = [
    `SetMapName(${luaString(info.name)})`,
    `SetMapDescription(${luaString(info.description)})`,
    `SetPlayers(${info.players.length})`,
    `SetTeams(${info.players.length})`,
    "SetGamePlacement(MAP_PLACEMENT_TEAMS_TOGETHER)",
    ...info.players.map((slot, index) => `DefineStartLocation(${index}, ${luaReal(slot.x)}, ${luaReal(slot.y)})`),
  ];
  for (const [index, slot] of info.players.entries()) {
    lines.push(
      `SetPlayerStartLocation(${player(slot.id)}, ${index})`,
      `SetPlayerColor(${player(slot.id)}, ConvertPlayerColor(${slot.id}))`,
      `SetPlayerRacePreference(${player(slot.id)}, RACE_PREF_HUMAN)`,
      `SetPlayerRaceSkin(${player(slot.id)}, ConvertRacePref(${slot.raceSkin}))`,
      `SetPlayerRaceSelectable(${player(slot.id)}, true)`,
      `SetPlayerController(${player(slot.id)}, MAP_CONTROL_USER)`,
    );
  }
  for (const [team, force] of info.forces.entries()) {
    const members = info.players.map((slot) => slot.id).filter((id) => (force.playerMask & (1 << id)) !== 0);
    for (const id of members) {
      lines.push(`SetPlayerTeam(${player(id)}, ${team})`);
      if ((force.flags & ALLIED_VICTORY) !== 0) lines.push(`SetPlayerState(${player(id)}, PLAYER_STATE_ALLIED_VICTORY, 1)`);
    }
    const pairs = members.flatMap((id) => members.filter((other) => other !== id).map((other) => [id, other] as const));
    if ((force.flags & ALLIED) !== 0) lines.push(...pairs.map(([id, other]) => `SetPlayerAllianceStateAllyBJ(${player(id)}, ${player(other)}, true)`));
    if ((force.flags & SHARED_VISION) !== 0) lines.push(...pairs.map(([id, other]) => `SetPlayerAlliance(${player(id)}, ${player(other)}, ALLIANCE_SHARED_VISION, true)`));
  }
  for (const index of info.players.keys()) lines.push(`SetStartLocPrioCount(${index}, 0)`, `SetEnemyStartLocPrioCount(${index}, 0)`);
  return `function mapConfig()\n${lines.map((line) => `    ${line}\n`).join("")}end\n`;
}
