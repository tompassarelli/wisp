/** Numbered files avoid Warcraft's session-long Preloader content cache. */
export const driverCommandFile = (prefix: string, serial: number): string => `${prefix}-hot\\driver-${serial}.txt`;
export const driverReadyFile = (prefix: string, serial: number): string => `${prefix}-hot\\driver-ready-${serial}.txt`;
export const driverStatusFile = (prefix: string): string => `${prefix}-hot\\driver-status.txt`;
