export interface RelayedPlayer {
  readonly label: string;
  readonly connected: boolean;
  readonly loaded: boolean;
  readonly left: boolean;
}

export interface RelayedStatus {
  readonly phase: "lobby" | "countdown" | "loading" | "playing" | "over";
  readonly players: readonly RelayedPlayer[];
}

/** Reads a relayed match's phase and each slot's join, load and leave from the relay's log; slot N is the pair's Nth client. */
export const relayedStatus = (relayLog: string, labels: readonly string[]): RelayedStatus => {
  const logged = (event: string) => new RegExp(`^\\S+ room [0-9a-f]{16} ${event}`, "m").test(relayLog);
  const players = labels.map((label, slot) => {
    const left = logged(`slot ${slot} Left\\(`);
    return { label, connected: logged(`slot ${slot} Joined `) && !left, loaded: logged(`slot ${slot} Loaded$`), left };
  });
  const phase = players.length > 0 && players.every(({ left }) => left) ? "over"
    : logged("playing$") ? "playing"
    : logged("phase Loading$") ? "loading"
    : logged("phase Countdown$") ? "countdown"
    : "lobby";
  return { phase, players };
};
