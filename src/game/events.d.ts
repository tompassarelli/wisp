export type Events = trigger;

export declare function createEvents(): Events;
export declare function onEvents(events: Events, handler: (this: void) => void): void;
export declare function destroyEvents(events: Events): void;
