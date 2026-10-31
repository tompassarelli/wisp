export type Events = trigger;

export declare function createEvents(): Events;
export declare function onEvents(events: Events, handler: () => void): void;
export declare function destroyEvents(events: Events): void;
