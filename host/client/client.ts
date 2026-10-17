import type { Client as Session } from "../os/warcraft/desktopClient";

export type Client = Pick<Session, "name" | "documents" | "menuReportPort">;

export const clientUnit = (name: string) => `wisp-client-${name}.service`;
