import type { NativeBehavior } from "../clientTypes";
import type { View } from "../../game/native/viewStore";
import type { Scenery } from "../warcraft3Scenery";

/** The camera and cinematic filter natives by their Warcraft names, as thin calls into the world's view store. */
export class ViewNatives {
  constructor(private readonly view: View, private readonly scenery: Scenery) {}

  behaviors(): Readonly<Record<string, NativeBehavior>> {
    const view = this.view;
    return {
      SetCameraPosition: (x: number, y: number) => { view.setCameraPosition(x, y); },
      GetCameraTargetPositionX: () => view.targetX(),
      GetCameraTargetPositionY: () => view.targetY(),
      SetCameraTargetController: () => { this.scenery.cameraAllowsHotkeyTargetLock = false; },
      SetCameraOrientController: () => { this.scenery.cameraAllowsHotkeyTargetLock = false; },
      SetCameraField: (field: unknown, value: number) => { view.setCameraField(field, value); },
      GetCameraField: (field: unknown) => view.cameraField(field),
      SetCineFilterTexture: (texture: string) => { view.setFilterTexture(texture); },
      SetCineFilterBlendMode: (mode: unknown) => { view.setFilterBlendMode(mode); },
      SetCineFilterTexMapFlags: (flags: unknown) => { view.setFilterTexMapFlags(flags); },
      SetCineFilterStartUV: (minU: number, minV: number, maxU: number, maxV: number) => { view.setFilterStartUV(minU, minV, maxU, maxV); },
      SetCineFilterEndUV: (minU: number, minV: number, maxU: number, maxV: number) => { view.setFilterEndUV(minU, minV, maxU, maxV); },
      SetCineFilterStartColor: (red: number, green: number, blue: number, alpha: number) => { view.setFilterStartColor(red, green, blue, alpha); },
      SetCineFilterEndColor: (red: number, green: number, blue: number, alpha: number) => { view.setFilterEndColor(red, green, blue, alpha); },
      SetCineFilterDuration: (duration: number) => { view.setFilterDuration(duration); },
      DisplayCineFilter: (flag: boolean) => { view.showFilter(flag); },
      IsCineFilterDisplayed: () => view.filterShown(),
    };
  }
}
