import { LIGHTNING_DATA, type LightningLook, lightningLook, missingColumns } from "../terrain/lightningData";
import { terrainRows } from "../terrain/terrainMesh";

type Reader = (path: string) => Promise<Uint8Array | undefined>;

/** Reads the install's lightning table once and each lightning type's look once, with the type's texture pushed to the window before the look is offered. */
export function createLightningLooks(read: Reader, push: (path: string) => Promise<void>, report: (problem: string) => void) {
  const looks = new Map<string, LightningLook | undefined>();
  let table: Promise<ReturnType<typeof terrainRows> | undefined> | undefined;
  let reading = 0;
  const rows = () => table ??= read(LIGHTNING_DATA).then((bytes) => {
    if (bytes === undefined) { report(`missing asset ${LIGHTNING_DATA}`); return undefined; }
    const parsed = terrainRows(bytes);
    const missing = missingColumns(parsed);
    if (missing.length > 0) report(`${LIGHTNING_DATA} has no ${missing.join(", ")} column`);
    return parsed;
  }).catch((cause: unknown) => { report(`${LIGHTNING_DATA}: ${cause instanceof Error ? cause.message : String(cause)}`); return undefined; });
  const load = async (codeName: string) => {
    const found = await rows();
    const look = found === undefined ? undefined : lightningLook(found, codeName);
    if (typeof look === "string") report(look);
    if (typeof look !== "object") return undefined;
    await push(look.texture);
    return look;
  };
  return {
    loading: () => reading,
    look(codeName: string): LightningLook | undefined {
      if (!looks.has(codeName)) {
        looks.set(codeName, undefined);
        reading++;
        void load(codeName).then((look) => { looks.set(codeName, look); }, (cause: unknown) => { report(`${codeName}: ${cause instanceof Error ? cause.message : String(cause)}`); }).finally(() => { reading--; });
      }
      return looks.get(codeName);
    },
  };
}
