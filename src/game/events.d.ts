import type { Opaque } from "./opaque";

export type Events = Opaque<"Events">;

export declare function createEvents(): Events;
export declare function onEvents(events: Events, handler: (this: void) => void): void;
export declare function destroyEvents(events: Events): void;
