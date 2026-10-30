import { Schema } from "effect";
import { CLIENT_PROFILE_NAMES } from "./clientProfiles";
import { describeCause } from "./describeCause";

export class DesktopFailure extends Schema.TaggedError<DesktopFailure, { readonly brand: unique symbol }>()("DesktopFailure", {
  operation: Schema.String,
  client: Schema.String,
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `${this.operation} failed for ${this.client}: ${describeCause(this.cause)}`;
  }
}

export const ClientsFile = Schema.Struct({
  tools: Schema.Struct({ grim: Schema.String, xdotool: Schema.String, wlrctl: Schema.String, tesseract: Schema.String }),
  clients: Schema.NonEmptyArray(Schema.Struct({ name: Schema.String, run: Schema.String, documents: Schema.String, menuReportPort: Schema.optional(Schema.Int), displaySettings: Schema.optional(Schema.Record(Schema.String, Schema.String)), profile: Schema.optional(Schema.Literals(CLIENT_PROFILE_NAMES)), offline: Schema.optionalKey(Schema.Boolean) })),
});
type Tools = typeof ClientsFile.Type["tools"];

export interface Client {
  readonly name: string;

  readonly documents: string;

  readonly menuReportPort?: number;
  readonly run?: string;
  readonly tools: Tools;
  readonly x11: Record<string, string>;
  readonly wayland: Record<string, string>;
  readonly window: string;
}

export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ClientsConfig = typeof ClientsFile.Type;
export type ClientEntry = ClientsConfig["clients"][number];
