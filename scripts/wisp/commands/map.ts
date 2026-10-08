import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, FileSystem, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { decodeMapInfo } from "../../mapInfo";
import { type Command, UsageFailure, describeCause } from "../command";
import { encodePpm } from "../frameProbe";
import { collect } from "../hostProcess";
import { ensurePackager } from "../mapBuild";
import { decodePreviewTexture, decodePreviewRgba, decodeMinimapMarkers, drawStartMarkers, selectMapPreview } from "../mapPreview";

export class MapPreviewFailure extends Schema.TaggedError<MapPreviewFailure>()("MapPreviewFailure", { problem: Schema.String }) {
  override get message() { return this.problem; }
}

export const map: Command = (args) => Effect.gen(function*() {
  const { values, positionals } = yield* Effect.try({
    try: () => parseArgs({ args: [...args], allowPositionals: true, options: { out: { type: "string" }, packager: { type: "string" }, assets: { type: "string" } } }),
    catch: (cause) => new UsageFailure({ problem: describeCause(cause) }),
  });
  if (positionals[0] !== "preview" || positionals.length !== 2 || values.out === undefined) return yield* new UsageFailure({ problem: "map preview MAP.w3x --out IMAGE.ppm [--packager PATH]" });
  const archive = resolve(positionals[1] ?? ""), out = resolve(values.out);
  const packager = resolve(values.packager ?? "build/tools/map-pack");
  const fs = yield* FileSystem.FileSystem;
  yield* ensurePackager(packager);
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "wisp-preview-" });
  const extract = (entry: string, file: string) => Effect.gen(function*() {
    const result = yield* collect(ChildProcess.make(packager, ["extract", archive, file, entry]));
    if (result.exitCode !== 0) return yield* new MapPreviewFailure({ problem: `cannot read ${entry}: ${result.stderr.trim()}` });
    return yield* fs.readFile(file);
  });
  const listed = new TextDecoder().decode(yield* extract("(listfile)", join(scratch, "list")));
  const entries = new Set(listed.split(/\r?\n/).map((entry) => entry.trim().toLowerCase()));
  const infoBytes = yield* extract("war3map.w3i", join(scratch, "info"));
  const info = yield* Effect.try({ try: () => decodeMapInfo(infoBytes), catch: (cause) => new MapPreviewFailure({ problem: describeCause(cause) }) });
  const selected = yield* Effect.try({ try: () => selectMapPreview(info, entries), catch: (cause) => new MapPreviewFailure({ problem: describeCause(cause) }) });
  const texture = yield* extract(selected.entry, join(scratch, "texture"));
  let frame = yield* Effect.try({ try: () => decodePreviewTexture(texture), catch: (cause) => new MapPreviewFailure({ problem: describeCause(cause) }) });
  const markerBytes = entries.has("war3map.mmp") ? yield* extract("war3map.mmp", join(scratch, "markers")) : undefined;
  const markers = yield* Effect.try({ try: () => markerBytes === undefined ? [] : decodeMinimapMarkers(markerBytes), catch: (cause) => new MapPreviewFailure({ problem: describeCause(cause) }) });
  if (values.assets !== undefined && markers.length > 0) {
    const iconBytes = yield* fs.readFile(join(values.assets, "UI/MiniMap/MinimapIcon/MinimapIconStartLoc.tga"));
    frame = yield* Effect.try({ try: () => drawStartMarkers(frame, markers, decodePreviewRgba(iconBytes)), catch: (cause) => new MapPreviewFailure({ problem: describeCause(cause) }) });
  }
  yield* fs.writeFile(out, encodePpm(frame));
  console.log(JSON.stringify({ map: archive, name: info.name, author: info.author, players: info.players.length, ...selected, markers, iconsRendered: markers.length === 0 || values.assets !== undefined, width: frame.width, height: frame.height, out }));
}).pipe(Effect.scoped, Effect.provide(BunServices.layer), Effect.mapError((cause) => new MapPreviewFailure({ problem: cause.message })));
