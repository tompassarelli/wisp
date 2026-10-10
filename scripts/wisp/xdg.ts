import { homedir } from "node:os";
import { join } from "node:path";

const base = (variable: string, fallback: string) => process.env[variable] ?? join(homedir(), fallback);

export const stateHome = () => base("XDG_STATE_HOME", ".local/state");
export const cacheHome = () => base("XDG_CACHE_HOME", ".cache");
export const dataHome = () => base("XDG_DATA_HOME", ".local/share");
