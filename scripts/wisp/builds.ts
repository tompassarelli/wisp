import { join } from "node:path";
import { Effect, Schema } from "effect";
import rollback from "../../builds/3.0.0.24268.json";
import patch from "../../builds/3.0.1.24342.json";

const Capability = Schema.Struct({ status: Schema.Literals(["supported", "unsupported", "unchecked"]), issue: Schema.String });
const Profile = Schema.Struct({
  id: Schema.String, version: Schema.String, build: Schema.Number,
  capabilities: Schema.Record(Schema.String, Capability),
  protocolVersion: Schema.NullOr(Schema.Number),
  natives: Schema.Struct({ naming: Schema.String, added: Schema.Array(Schema.String) }),
  menus: Schema.Struct({ lobbySettleMs: Schema.Number, scoreClose: Schema.Literals(["Escape", "ScoreScreenClose"]), lobbyBack: Schema.Struct({ x: Schema.Number, y: Schema.Number }) }),
  quirks: Schema.Array(Schema.Struct({ description: Schema.String, issue: Schema.String })),
});
export type BuildProfile = typeof Profile.Type;
export const BUILD_PROFILES = [rollback, patch].map((profile) => Schema.decodeUnknownSync(Profile)(profile));
export const DEFAULT_BUILD = "3.0.0.24268";
export const BUILD_CAPABILITIES = ["lanPool", "privateLanSwitch", "engineDebugger", "padDriver", "menuDriving", "frameNumberRead", "classic", "definitive"] as const;
export type BuildCapability = typeof BUILD_CAPABILITIES[number];
export const BUILD_COMMANDS = {
  "lan pool": "lanPool", "lan fresh": "privateLanSwitch", "lan dummy": "lanPool",
  "lan solo": "menuDriving", "menus host": "menuDriving", "menus join": "menuDriving",
  "menus start": "menuDriving", "play": "menuDriving", "engine poll": "engineDebugger",
  "engine trace": "engineDebugger", "engine lua": "engineDebugger", "engine drive": "padDriver",
} as const satisfies Readonly<Record<string, BuildCapability>>;

export class BuildFailure extends Schema.TaggedError<BuildFailure>()("BuildFailure", { problem: Schema.String }) {
  override get message(): string { return this.problem; }
}
export const profileFor = (id: string) => BUILD_PROFILES.find((profile) => profile.id === id);
export const privateBuildPath = (id: string) => join(process.env["HOME"] ?? "", ".local/share/wisp-private/builds", `${id}.json`);

export function capabilityProblem(id: string, capability: BuildCapability): string | undefined {
  const entry = profileFor(id)?.capabilities[capability];
  if (entry === undefined || entry.status === "unchecked") return `${capability} missing for ${id}; run client doctor to check this build (wisp#100)`;
  if (entry.status === "unsupported") return `${capability} not supported on ${id} (${entry.issue})`;
  return undefined;
}
export const requireCapability = (id: string, capability: BuildCapability) => Effect.suspend(() => {
  const problem = capabilityProblem(id, capability);
  return problem === undefined ? Effect.succeed(profileFor(id)!) : Effect.fail(new BuildFailure({ problem }));
});
export const requireBuildCommand = (id: string, command: keyof typeof BUILD_COMMANDS) => requireCapability(id, BUILD_COMMANDS[command]);
export const buildProfileLines = (id: string) => {
  const profile = profileFor(id);
  return profile === undefined ? [`unknown build ${id}; discovery needed (wisp#100)`]
    : [`build profile ${id}`, ...BUILD_CAPABILITIES.map((name) => `${name}: ${profile.capabilities[name]?.status ?? "unchecked"}`), `protocol: ${profile.protocolVersion ?? "unchecked"}`, `menus: ${profile.menus.scoreClose}, lobby wait ${profile.menus.lobbySettleMs} ms`];
};
