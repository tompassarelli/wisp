import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/map/fileio";
import { PLACEMENTS, READY_FILE, type Parent } from "./layout";

function parentFrame(this: void, parent: Parent, created: Map<string, framehandle>): framehandle {
  if (parent === "console") return BlzGetFrameByName("ConsoleUIBackdrop", 0);
  if (parent === "red") return created.get("abs-scaled") ?? BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0);
  return BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, 0);
}

function place(this: void): void {
  const created = new Map<string, framehandle>();
  const rows: string[] = [];
  for (const placement of PLACEMENTS) {
    const frame = BlzCreateFrameByType("BACKDROP", `Wisp125${placement.name}`, parentFrame(placement.parent, created), "", 0);
    BlzFrameSetTexture(frame, placement.texture, 0, true);
    BlzFrameSetSize(frame, placement.size, placement.size);
    if (placement.scale !== 1) BlzFrameSetScale(frame, placement.scale);
    const point = placement.point === "center" ? FRAMEPOINT_CENTER : FRAMEPOINT_TOPLEFT;
    if (placement.abs !== undefined) BlzFrameSetAbsPoint(frame, point, placement.abs[0], placement.abs[1]);
    const relative = placement.relative;
    const to = relative === undefined ? undefined : created.get(relative.to);
    if (relative !== undefined && to !== undefined) {
      const corner = relative.to === "anchor" ? FRAMEPOINT_BOTTOMRIGHT : FRAMEPOINT_TOPRIGHT;
      BlzFrameSetPoint(frame, point, to, corner, relative.x, relative.y);
    }
    created.set(placement.name, frame);
    rows.push(placement.name);
  }
  writeLines(READY_FILE, [`ready=${rows.length}`, `width=${BlzGetLocalClientWidth()}`, `height=${BlzGetLocalClientHeight()}`]);
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "frames125", readyPrefix: "FR_HRR", globalPrefix: "__frames125" });
}

export function start(this: void): void {
  install();
  FogEnable(false);
  FogMaskEnable(false);
  TimerStart(CreateTimer(), 1, false, () => {
    DestroyTimer(GetExpiredTimer());
    place();
  });
}
