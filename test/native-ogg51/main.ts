import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/platform/fileio";

export function install(this: void): void {
  configureRuntime({ filePrefix: "native-ogg51", readyPrefix: "OGG51_HRR", globalPrefix: "__nativeOgg51" });
}

export function start(this: void): void {
  install();
  const cue = CreateSound("war3mapImported\\RiflemanWarcry1.ogg", false, false, false, 10, 10, "");
  SetSoundVolume(cue, 127);
  const lines = ["cue=RiflemanWarcry1.ogg", "bytes=24261", `duration-before-ms=${GetSoundDuration(cue)}`];
  TimerStart(CreateTimer(), 3.0, false, () => {
    StartSound(cue);
    lines.push("start-count=1");
    lines.push(`duration-after-ms=${GetSoundDuration(cue)}`);
    TimerStart(CreateTimer(), 0.25, false, () => {
      lines.push(`playing-after-250ms=${GetSoundIsPlaying(cue)}`);
      writeLines(`native-ogg51-p${GetPlayerId(GetLocalPlayer())}.txt`, lines);
    });
  });
}
