// A LAN game host for offline development clients (wisp:docs/lan.md). It
// lists one game to the clients' LAN ports, takes their joins, runs the
// countdown and loading, then relays the game in turns: every `turnMs` it sends
// every client the actions collected since the last turn. Because every
// action passes through it, it writes the action log: each turn's actions by
// player, decoded (orders, BlzSendSyncData payloads with their prefixes,
// frame and key events, chat), joins, loads and leaves; and it compares the
// state checksum every client returns for every turn, so a desync is named by
// its turn the moment it happens.
//
// Its join burst and game loop follow W3Champions' Flo (MPL-2.0) as
// wc3-slop-lan describes it for 3.0.0.24268; this is Wisp's own code.
import type { Socket, TCPSocketListener, udp } from "bun";
import { Deferred, Effect, Exit, Fiber, Schedule, Scope, Semaphore } from "effect";
import { decodeActions } from "./actions";
import { LanFailure } from "./join";
import type { MapFacts } from "./map";
import {
  CHAT, DEFAULT_GAME_FLAGS, LEAVE_REASONS, PACKET, PRODUCT, PROTOBUF, PROTOCOL_VERSION, RACE_RANDOM_SELECTABLE, SLOT_CLOSED, SLOT_OCCUPIED, SLOT_OPEN,
  type Chat, type PlayerAction, type Slot, type SlotTable,
  chatFromHost, countDownEnd, countDownStart, decodeChat, decodeKeepAlive, decodeLeaveReq, decodeMapSize, decodeOutgoingAction, decodeReqJoin, decodeSearchGame,
  gameInfo, incomingAction, leaveAck, mapCheck, pingFromHost, playerInfo, playerLeft, playerLoaded, playerProfile, playerSkins, protobufType, rejectJoin, slotInfo, slotInfoJoin, splitPackets,
} from "./w3gs";

/** Where 3.0 clients listen for LAN games: each takes the first free UDP port from 16000. */
export const CLIENT_PORTS: readonly number[] = [16000, 16001, 16002, 16003, 16004, 16005, 16006, 16007];
/** Flo waits this long between the countdown packets; sooner sends slow clients to the score screen. */
export const COUNTDOWN_MS = 6000;
/** The longest step one turn may carry after a stall. */
const MAX_STEP_MS = 250;
/** How many turns a client may leave unanswered before the host waits for it. */
const SYNC_LIMIT = 50;
/** Clients drop a host that stays silent before the game starts; classic hosts ping every few seconds. */
const PING_MS = 3000;
/** Turns between time marks in the action log. */
const MARK_TURNS = 32;
/** Time for a join burst's echoes to arrive before the countdown. */
const JOIN_SETTLE_MS = 1500;
const RACE_BITS: Readonly<Record<number, number>> = { 1: 0x01, 2: 0x02, 3: 0x08, 4: 0x04 };

export type Phase = "lobby" | "countdown" | "loading" | "playing" | "over";

export interface HostOptions {
  readonly map: MapFacts;
  readonly gameName: string;
  /** Names for the joining clients in join order: client a, client b. */
  readonly clients: readonly string[];
  /** Milliseconds a turn covers (the game's send interval). */
  readonly turnMs?: number;
  /** TCP port to listen on; 0 picks one. */
  readonly port?: number;
  readonly announcePorts?: readonly number[];
  /** Computer players (normal) in the map's user slots after the clients'. */
  readonly computers?: number;
  /** Milliseconds between the countdown packets (COUNTDOWN_MS); tests shorten it. */
  readonly countdownMs?: number;
  /** Milliseconds after the last join before the countdown (JOIN_SETTLE_MS). */
  readonly settleMs?: number;
  /** Keep a lobby open for protocol checks. */
  readonly autoStart?: boolean;
  /** Each action-log line, already formatted. */
  readonly log: (line: string) => void;
  /** Called when the phase changes. */
  readonly onPhase?: (phase: Phase) => void;
  /** Called on a desync: the turn and each client's checksum. */
  readonly onDesync?: (turn: number, sums: Readonly<Record<string, number>>) => void;
  readonly now?: () => number;
  /** Every packet sent or received, for recording an exchange: direction, client label, the whole packet. */
  readonly onPacket?: (direction: "in" | "out", client: string, packet: Uint8Array) => void;
}

interface Player {
  readonly label: string;
  readonly slot: number;
  readonly pid: number;
  joinedAs: string;
  socket: Socket<Connection> | undefined;
  mapOk: boolean;
  skins: boolean;
  unknown5: boolean;
  loaded: boolean;
  left: boolean;
  checksums: number[];
}

interface Connection {
  /** In order of connecting, from 1. */
  readonly id: number;
  buffer: Uint8Array;
  player: Player | undefined;
}

export interface HostStatus {
  readonly phase: Phase;
  readonly speed: number;
  readonly turns: number;
  readonly gameSeconds: number;
  readonly desyncs: number;
  readonly players: readonly { readonly label: string; readonly pid: number; readonly joinedAs: string; readonly connected: boolean; readonly loaded: boolean; readonly left: boolean; readonly checksums: number }[];
}

export interface LanHost {
  readonly port: number;
  readonly status: () => HostStatus;
  readonly slots: () => SlotTable;
  readonly say: (from: number, to: number, text: string) => void;
  /** Queues an action as `pid`'s for the next turn (a seat's or any player's). */
  readonly inject: (pid: number, data: Uint8Array) => void;
  /** Deliver unchanged game-time turns sooner; clients may still limit their own clocks. */
  readonly setSpeed: (multiple: number) => Effect.Effect<void, LanFailure>;
}

/** The slot table for `count` human players in the map's first user slots; other map slots closed. */
/**
 * The slot table: `count` clients in the map's first user slots, `computers`
 * computer players (normal) in the next ones, every other slot closed.
 */
export function slotTable(map: MapFacts, count: number, randomSeed: number, joined: (slot: number) => boolean, computers = 0): SlotTable {
  const users = map.players.filter(({ controller }) => controller === 1).map(({ id }) => id);
  if (users.length < count + computers) throw new Error(`the map has ${users.length} user slots; ${count} clients and ${computers} computers need as many`);
  const used = new Set(users.slice(0, count));
  const computer = new Set(users.slice(count, count + computers));
  const forceOf = (id: number) => Math.max(0, map.forces.findIndex((mask) => (mask & (1 << id)) !== 0));
  const slots = map.players.map(({ id, race }, index): Slot => {
    const occupied = used.has(id) && joined(id);
    return {
      playerId: occupied ? id + 1 : 0,
      download: occupied || computer.has(id) ? 100 : 255,
      status: occupied || computer.has(id) ? SLOT_OCCUPIED : used.has(id) ? SLOT_OPEN : SLOT_CLOSED,
      computer: computer.has(id),
      team: (map.layout & 1) !== 0 ? forceOf(id) : index,
      color: id,
      race: (map.layout & 2) !== 0 ? (RACE_BITS[race] ?? RACE_RANDOM_SELECTABLE) | 0x40 : RACE_RANDOM_SELECTABLE,
      computerType: 1,
      handicap: 100,
    };
  });
  return { slots, randomSeed, layout: map.layout, players: map.players.length };
}

export const startHost = (options: HostOptions) => Effect.gen(function*() {
  const scope = yield* Effect.scope;
  const speedLock = yield* Semaphore.make(1);
  const lobbyScope = yield* Scope.fork(scope);
  const lobbyEnded = yield* Deferred.make<void>();
  const now = options.now ?? (() => performance.now());
  const turnMs = options.turnMs ?? 30;
  const started = now();
  const seconds = () => ((now() - started) / 1000).toFixed(3);
  const line = (text: string) => options.log(`${seconds()} ${text}`);
  const randomSeed = (Math.random() * 0x7fffffff) | 0;
  const users = options.map.players.filter(({ controller }) => controller === 1).map(({ id }) => id);
  if (users.length < options.clients.length + (options.computers ?? 0)) return yield* new LanFailure({ problem: `the map has ${users.length} user slots; ${options.clients.length} clients and ${options.computers ?? 0} computers need as many` });
  const players: Player[] = options.clients.map((label, index) => {
    const slot = users[index];
    if (slot === undefined) throw new Error("validated player slot is missing");
    return { label, slot, pid: slot + 1, joinedAs: "", socket: undefined, mapOk: false, skins: false, unknown5: false, loaded: false, left: false, checksums: [] };
  });
  const byPid = (pid: number) => players.find((player) => player.pid === pid);
  const nameOf = (pid: number) => byPid(pid)?.label ?? `p${pid}`;
  let phase: Phase = "lobby";
  let countdownAt = 0;
  let turns = 0;
  let gameMs = 0;
  let lastTurn = 0;
  let speed = 1;
  let waiting = false;
  let desyncs = 0;
  let pending: PlayerAction[] = [];
  let lastJoin = 0;
  let connections = 0;
  let lastPing = 0;
  let discovery: udp.Socket<"buffer"> | undefined;
  const reported = new Set<number>();
  const handicaps = new Map<number, number>();
  const setPhase = (next: Phase) => {
    phase = next;
    // Discovery serves only the lobby. Bun 1.3.13 can spin on a socket that
    // received ECONNREFUSED from an unused announcement port.
    if (next !== "lobby") {
      Deferred.doneUnsafe(lobbyEnded, Effect.void);
    }
    line(`phase ${next}`);
    options.onPhase?.(next);
  };
  const table = (): SlotTable => {
    const base = slotTable(options.map, players.length, randomSeed, (slot) => players.some((player) => player.slot === slot && player.socket !== undefined && !player.left), options.computers ?? 0);
    return { ...base, slots: base.slots.map((slot) => ({ ...slot, handicap: handicaps.get(slot.playerId) ?? slot.handicap })) };
  };
  const send = (player: Player, packet: Uint8Array) => {
    if (player.socket === undefined) return;
    options.onPacket?.("out", player.label, packet);
    player.socket.write(packet);
  };
  const broadcast = (packet: Uint8Array) => {
    for (const player of players) if (!player.left) send(player, packet);
  };

  const welcome = (player: Player) => {
    const socket = player.socket;
    if (socket === undefined) return;
    const remote = socket.remoteAddress.split(".").map(Number);
    send(player, slotInfoJoin(table(), player.pid, { ip: remote.length === 4 ? remote : [127, 0, 0, 1], port: socket.remotePort ?? 0 }));
    send(player, slotInfo(table()));
    const others = players.filter((other) => other !== player && other.socket !== undefined && !other.left);
    for (const other of others) send(player, playerInfo(other.pid, other.joinedAs));
    for (const other of others) send(player, playerSkins(other.pid));
    for (const other of [...others, player]) send(player, playerProfile(other.pid, other.joinedAs));
    send(player, mapCheck(options.map));
    for (const other of others) {
      send(other, playerInfo(player.pid, player.joinedAs));
      send(other, playerSkins(player.pid));
      send(other, playerProfile(player.pid, player.joinedAs));
      send(other, slotInfo(table()));
    }
  };

  const leave = (player: Player, reason: number) => {
    if (player.left) return;
    player.left = true;
    line(`left ${player.label} p${player.pid} ${LEAVE_REASONS[reason] ?? `reason ${reason}`}`);
    broadcast(playerLeft(player.pid, reason));
    if (phase === "lobby") {
      player.left = false;
      player.socket = undefined;
      player.mapOk = player.skins = player.unknown5 = false;
      handicaps.delete(player.pid);
      broadcast(slotInfo(table()));
    }
    if (phase === "playing" && players.every((each) => each.left)) setPhase("over");
  };

  const compare = () => {
    const active = players.filter((player) => !player.left && player.socket !== undefined);
    const answered = Math.min(...active.map((player) => player.checksums.length));
    if (!Number.isFinite(answered) || answered === 0) return;
    const turn = answered - 1;
    const sums = Object.fromEntries(active.map((player) => [player.label, player.checksums[turn] ?? 0]));
    const values = new Set(Object.values(sums));
    if (values.size > 1 && !reported.has(turn)) {
      desyncs++;
      reported.add(turn);
      line(`desync turn ${turn} ${Object.entries(sums).map(([label, sum]) => `${label}=${sum.toString(16).padStart(8, "0")}`).join(" ")}`);
      options.onDesync?.(turn, sums);
    }
  };

  const handle = (connection: Connection, socket: Socket<Connection>, type: number, payload: Uint8Array) => {
    options.onPacket?.("in", connection.player?.label ?? `#${connection.id}`, new Uint8Array([0xf7, type, (payload.length + 4) & 0xff, (payload.length + 4) >>> 8, ...payload]));
    if (type === PACKET.ReqJoin) {
      const request = decodeReqJoin(payload);
      const player = players.find((candidate) => candidate.socket === undefined && !candidate.left);
      if (player === undefined || phase !== "lobby") {
        line(`refused join ${JSON.stringify(request.name)}: ${phase === "lobby" ? "full" : "started"}`);
        socket.write(rejectJoin(phase === "lobby" ? 0x09 : 0x0a));
        return;
      }
      player.socket = socket;
      player.joinedAs = request.name;
      connection.player = player;
      lastJoin = now();
      line(`join ${player.label} p${player.pid} as ${JSON.stringify(request.name)} from ${socket.remoteAddress}:${socket.remotePort}`);
      welcome(player);
      return;
    }
    const player = connection.player;
    if (player === undefined) return;
    switch (type) {
      case PACKET.MapSize: {
        const { size } = decodeMapSize(payload);
        player.mapOk = size === options.map.size;
        line(player.mapOk ? `map ${player.label} has it` : `map ${player.label} reports ${size} bytes, expected ${options.map.size}: a different file or checksum`);
        break;
      }
      case PACKET.ProtoBuf: {
        const kind = protobufType(payload);
        if (kind === PROTOBUF.PlayerSkins) player.skins = true;
        if (kind === PROTOBUF.PlayerUnknown5) player.unknown5 = true;
        send(player, new Uint8Array([0xf7, PACKET.ProtoBuf, (payload.length + 4) & 0xff, (payload.length + 4) >>> 8, ...payload]));
        break;
      }
      case PACKET.GameLoadedSelf:
        player.loaded = true;
        line(`loaded ${player.label} p${player.pid}`);
        broadcast(playerLoaded(player.pid));
        break;
      case PACKET.OutgoingAction:
        pending.push({ playerId: player.pid, data: decodeOutgoingAction(payload) });
        break;
      case PACKET.OutgoingKeepAlive:
        player.checksums.push(decodeKeepAlive(payload));
        compare();
        break;
      case PACKET.ChatToHost: {
        const chat: Chat = decodeChat(payload);
        if (phase === "lobby" && chat.kind === CHAT.HandicapChange && chat.from === player.pid && chat.value !== undefined && [50, 60, 70, 80, 90, 100].includes(chat.value)) {
          handicaps.set(player.pid, chat.value);
          line(`slot ${player.label} p${player.pid} handicap ${chat.value}`);
          broadcast(slotInfo(table()));
          break;
        }
        if (chat.kind === CHAT.Chat || chat.kind === CHAT.Scoped) line(`chat ${player.label} p${player.pid} ${JSON.stringify(chat.text ?? "")}`);
        const relay = chatFromHost(chat);
        for (const to of chat.to) {
          const target = byPid(to);
          if (target !== undefined && target !== player) send(target, relay);
        }
        break;
      }
      case PACKET.LeaveReq:
        send(player, leaveAck());
        leave(player, decodeLeaveReq(payload));
        break;
      case PACKET.PongToHost:
        break;
      default:
        line(`packet 0x${type.toString(16)} from ${player.label} (${payload.length} bytes)`);
        break;
    }
  };

  const listener: TCPSocketListener<Connection> = yield* Effect.acquireRelease(Effect.try({ try: () => Bun.listen<Connection>({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    socket: {
      open: (socket) => {
        socket.data = { id: ++connections, buffer: new Uint8Array(), player: undefined };
      },
      data: (socket, chunk) => {
        const connection = socket.data;
        const joined = new Uint8Array(connection.buffer.length + chunk.length);
        joined.set(connection.buffer);
        joined.set(chunk, connection.buffer.length);
        try {
          const { packets, rest } = splitPackets(joined);
          connection.buffer = rest;
          for (const packet of packets) handle(connection, socket, packet.type, packet.payload);
        } catch (cause) {
          line(`dropped ${connection.player?.label ?? "a connection"}: ${cause instanceof Error ? cause.message : String(cause)}`);
          socket.end();
        }
      },
      close: (socket) => {
        const player = socket.data.player;
        if (player !== undefined && player.socket === socket) leave(player, 0x01);
      },
    },
  }), catch: (cause) => new LanFailure({ problem: `LAN listener: ${String(cause)}` }) }), (listener) => Effect.sync(() => listener.stop(true)));

  const listing = () => gameInfo({
    product: PRODUCT,
    version: PROTOCOL_VERSION,
    hostCounter: 1,
    entryKey: 0,
    name: options.gameName,
    settings: { flags: DEFAULT_GAME_FLAGS, width: options.map.width, height: options.map.height, xoro: options.map.xoro, path: options.map.path, hostName: "Wisp", sha1: options.map.sha1 },
    slots: options.map.players.length,
    openSlots: players.filter((player) => player.socket === undefined).length,
    uptimeSeconds: Math.floor((now() - started) / 1000),
    port: listener.port,
  });
  discovery = yield* Effect.acquireRelease(Effect.tryPromise({ try: () => Bun.udpSocket({
    hostname: "127.0.0.1",
    socket: {
      // Announcing to a port no client holds comes back as ECONNREFUSED on the next receive.
      error: () => {},
      data: (socket, data, port) => {
        if (data[0] !== 0xf7 || data[1] !== PACKET.SearchGame || phase !== "lobby") return;
        const search = decodeSearchGame(data.subarray(4));
        if (search.product === PRODUCT) socket.send(listing(), port, "127.0.0.1");
      },
    },
  }), catch: (cause) => new LanFailure({ problem: `LAN discovery: ${String(cause)}` }) }), (socket) => Effect.sync(() => { socket.close(); discovery = undefined; })).pipe(Scope.provide(lobbyScope));
  yield* Effect.forkScoped(Deferred.await(lobbyEnded).pipe(Effect.andThen(Scope.close(lobbyScope, Exit.void))));

  const tick = () => {
    const at = now();
    if (phase !== "playing" && at - lastPing >= PING_MS) {
      lastPing = at;
      broadcast(pingFromHost(Math.floor(at)));
    }
    if (phase === "lobby") {
      if (discovery !== undefined) {
        for (const port of options.announcePorts ?? CLIENT_PORTS) {
          try {
            discovery.send(listing(), port, "127.0.0.1");
          } catch {
            // Nothing listens on that port: fewer clients than ports.
          }
        }
      }
      // Skins and profiles are echoed only when other players exist; a lone client sends none.
      if (options.autoStart !== false && players.every((player) => player.socket !== undefined && player.mapOk && (players.length === 1 || player.skins)) && at - lastJoin >= (options.settleMs ?? JOIN_SETTLE_MS)) {
        broadcast(slotInfo(table()));
        broadcast(countDownStart());
        countdownAt = at + (options.countdownMs ?? COUNTDOWN_MS);
        setPhase("countdown");
      }
    } else if (phase === "countdown" && at >= countdownAt) {
      broadcast(countDownEnd());
      setPhase("loading");
    } else if (phase === "loading" && players.filter((player) => !player.left).every((player) => player.loaded)) {
      lastTurn = at;
      setPhase("playing");
    } else if (phase === "playing") {
      const behind = Math.max(0, ...players.filter((player) => !player.left).map((player) => turns - player.checksums.length));
      if (behind > SYNC_LIMIT) {
        if (!waiting) line(`waiting: a client is ${behind} turns behind`);
        waiting = true;
        lastTurn = at;
        return;
      }
      if (waiting) line("caught up");
      waiting = false;
      const step = speed === 1 ? Math.min(MAX_STEP_MS, Math.round(at - lastTurn)) : turnMs;
      lastTurn = at;
      const actions = pending;
      pending = [];
      broadcast(incomingAction(step, actions));
      gameMs += step;
      for (const action of actions) {
        for (const decoded of decodeActions(action.data)) line(`turn ${turns} ${nameOf(action.playerId)} p${action.playerId} ${decoded.kind} ${decoded.text}`);
      }
      turns++;
      // A time mark about once a second, so other logs (presence births) align with turns between actions.
      if (turns % MARK_TURNS === 0) line(`mark turn ${turns} game ${(gameMs / 1000).toFixed(3)}`);
    }
  };
  yield* Effect.forkScoped(Effect.sync(() => {
    if (phase !== "playing") tick();
  }).pipe(Effect.repeat(Schedule.fixed("250 millis")), Effect.delay("250 millis")));
  const sendTurn = Effect.sync(() => {
    if (phase === "playing") tick();
  });
  const turnLoop = () => sendTurn.pipe(Effect.repeat(Schedule.fixed(turnMs / speed)), Effect.delay(turnMs / speed));
  let turnFiber = yield* Effect.forkScoped(turnLoop());
  line(`host ${JSON.stringify(options.gameName)} map ${options.map.path} on 127.0.0.1:${listener.port}, turns of ${turnMs} ms, clients ${options.clients.join(", ")}`);

  return {
    port: listener.port,
    slots: table,
    say: (from, to, text) => {
      const target = byPid(to);
      if (target !== undefined) send(target, chatFromHost({ from, to: [to], kind: CHAT.Chat, text }));
    },
    status: () => ({
      phase,
      speed,
      turns,
      gameSeconds: gameMs / 1000,
      desyncs,
      players: players.map((player) => ({ label: player.label, pid: player.pid, joinedAs: player.joinedAs, connected: player.socket !== undefined, loaded: player.loaded, left: player.left, checksums: player.checksums.length })),
    }),
    inject: (pid, data) => {
      pending.push({ playerId: pid, data });
    },
    setSpeed: (multiple) => Effect.gen(function*() {
      if (!Number.isFinite(multiple) || multiple < 1 || multiple > 16) return yield* new LanFailure({ problem: "LAN speed must be between 1 and 16" });
      yield* Fiber.interrupt(turnFiber);
      speed = multiple;
      lastTurn = now();
      turnFiber = yield* Effect.forkIn(turnLoop(), scope);
      line(`speed ${speed}`);
    }).pipe(speedLock.withPermit),
  } satisfies LanHost;
});
