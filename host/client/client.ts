import type { Client as Session } from "../contract/client";

export type Client = Pick<Session, "name" | "documents" | "menuReportPort">;

export const clientUnit = (name: string) => `wisp-client-${name}.service`;
