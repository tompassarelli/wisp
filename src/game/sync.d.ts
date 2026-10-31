import type { Events } from "./events";
import type { Player } from "./players";

export declare function sendSync(prefix: string, data: string): boolean;
export declare function addSyncEvent(events: Events, player: Player, prefix: string): void;
export declare function syncData(): string;
export declare function syncPrefix(): string;
