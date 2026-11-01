export interface PlayerSlots {
  readonly slot: number;
  readonly humans: readonly number[];
  readonly names: Readonly<Record<number, string>> | undefined;
  /** The handle of the force of every player. */
  readonly forces: { playersAll(): unknown };
  readonly roundTripMs?: ((this: void, slot: number) => number) | undefined;
}

/** The players of one running game: who this client is, who plays, their names and the colour the map gave each slot. */
export class Players {
  private readonly colors = new Map<number, unknown>();

  constructor(private readonly slots: PlayerSlots) {}

  local(): number {
    return this.slots.slot;
  }

  all(): unknown {
    return this.slots.forces.playersAll();
  }

  playing(slot: number): boolean {
    return this.slots.humans.includes(slot);
  }

  roundTripMs(slot: number): number {
    if (slot === this.slots.slot || !this.playing(slot)) return -1;
    return this.slots.roundTripMs?.(slot) ?? -1;
  }

  name(slot: number): string {
    return this.slots.names?.[slot] ?? `Player ${slot + 1}`;
  }

  control(slot: number): string {
    return this.playing(slot) ? "MAP_CONTROL_USER" : "MAP_CONTROL_NONE";
  }

  slotState(slot: number): string {
    return this.playing(slot) ? "PLAYER_SLOT_STATE_PLAYING" : "PLAYER_SLOT_STATE_EMPTY";
  }

  setColor(slot: number, color: unknown): void {
    this.colors.set(slot, color);
  }

  color(slot: number): unknown {
    return this.colors.get(slot);
  }
}
