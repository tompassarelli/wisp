import { expect, test } from "bun:test";
import { sampleObjectData } from "../examples/sample/scripts/objects";

/** Reads format 2 independently of the writer, including the per-level layout. */
function decode(bytes: Uint8Array, leveled: boolean) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const int = () => { const value = view.getInt32(offset, true); offset += 4; return value; };
  const raw = () => { const value = new TextDecoder().decode(bytes.subarray(offset, offset + 4)); offset += 4; return value; };
  expect(int()).toBe(2);
  expect(int()).toBe(0);
  const count = int();
  const objects = [];
  for (let index = 0; index < count; index++) {
    const base = raw(), id = raw(), modifications = int(), fields = [];
    for (let fieldIndex = 0; fieldIndex < modifications; fieldIndex++) {
      const field = raw(), type = int(), level = leveled ? int() : 0, column = leveled ? int() : 0;
      let value: number | string;
      if (type === 0) value = int();
      else if (type === 1 || type === 2) { value = view.getFloat32(offset, true); offset += 4; }
      else if (type === 3) {
        const start = offset;
        while (bytes[offset] !== 0 && offset < bytes.length) offset++;
        value = new TextDecoder().decode(bytes.subarray(start, offset++));
      } else throw new Error(`invalid binary value type ${type}`);
      expect(int()).toBe(0);
      fields.push({ field, type, level, column, value });
    }
    objects.push({ base, id, fields });
  }
  expect(offset).toBe(bytes.length);
  return objects;
}

test("[reference] the authored unit and both ability levels preserve requested binary types, columns and values", () => {
  const [unitFile, abilityFile] = sampleObjectData();
  const unit = decode(unitFile?.contents ?? new Uint8Array(), false)[0];
  expect(unit).toMatchObject({ base: "hfoo", id: "u001" });
  expect(unit?.fields).toContainEqual({ field: "usca", type: 1, level: 0, column: 0, value: 1.25 });
  expect(unit?.fields).toContainEqual({ field: "uabi", type: 3, level: 0, column: 0, value: "A001" });
  const abilities = decode(abilityFile?.contents ?? new Uint8Array(), true);
  expect(abilities.map(({ id }) => id)).toEqual(["$wsl", "A001"]);
  const fields = abilities[1]?.fields ?? [];
  for (const level of [1, 2]) {
    expect(fields).toContainEqual({ field: "Hbz2", type: 2, level, column: 2, value: level * 10 });
    expect(fields).toContainEqual({ field: "Hbz1", type: 0, level, column: 1, value: level * 2 });
    expect(fields).toContainEqual({ field: "acdn", type: 2, level, column: 0, value: level * 3 });
    expect(fields).toContainEqual({ field: "atp1", type: 3, level, column: 0, value: `Wisp Snow - Level ${level}` });
  }
});
