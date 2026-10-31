import type { Lowering } from "./lowering";

export const sound: Lowering = {
  createSound: "CreateSound($1, $2, $3, $4, $5, $6, $7)",
  soundFromLabel: "CreateSoundFromLabel($1, $2, $3, $4, $5, $6)",
  playSound: "StartSound($1)",
  stopSound: "StopSound($1, $2, $3)",
  setSoundVolume: "SetSoundVolume($1, $2)",
  setSoundPitch: "SetSoundPitch($1, $2)",
  setSoundPosition: "SetSoundPosition($1, $2, $3, $4)",
  setSoundDistances: "SetSoundDistances($1, $2, $3)",
  setSoundCutoff: "SetSoundDistanceCutoff($1, $2)",
  setSoundDuration: "SetSoundDuration($1, $2)",
  releaseWhenDone: "KillSoundWhenDone($1)",
  soundFileDuration: "GetSoundFileDuration($1)",
  playMusic: "PlayMusic($1)",
  stopMusic: "StopMusic($1)",
  clearMusic: "ClearMapMusic()",
  playTheme: "PlayThematicMusic($1)",
  endTheme: "EndThematicMusic()",
  setVolumeGroup: "VolumeGroupSetVolume($1, $2)",
  resetVolumeGroups: "VolumeGroupReset()",
};
