# Typed object definitions

Author custom Warcraft units and abilities in a Bun build script with
`UnitObject` and `AbilityObject` from `wisp/scripts/objectData`. Import the
numeric IDs from the same small source module as the map. The sample uses
`examples/sample/src/objectIds.ts`; its build definitions are in
`examples/sample/scripts/objects.ts`.

```ts
const walker = new UnitObject(WALKER_ID, "hfoo")
  .name("Wisp Rider").model("units\\human\\Knight\\Knight.mdl")
  .scale(1.25).hitPoints(420).movementSpeed(180).abilities([SNOW_ID]).build();
const snow = new AbilityObject(SNOW_ID, "AHbz").name("Wisp Snow").hero(false).levels(2)
  .tooltip(1, "Snow - Level 1").manaCost(1, 0).cooldown(1, 3).blizzardDamage(1, 10)
  .tooltip(2, "Snow - Level 2").manaCost(2, 0).cooldown(2, 6).blizzardDamage(2, 20).build();
const objectData = [
  { entry: "war3map.w3u", contents: encodeObjectData([walker], false) },
  { entry: "war3map.w3a", contents: abilityData([snow]) },
];
```

Pass `objectData` to `maps.build()` ([sample map](sample-map.md)). `abilityData`
includes FileIO's `$wsl` ability, which hot reload requires. When supplying
your own `war3map.w3a`, use this function rather than omitting FileIO.

The constructors take the new numeric ID and the four-character stock base
ID. Setters return the builder; `build()` returns an `ObjectDefinition` for
the existing writer. Repeating a setter replaces that field at the same
level and column. Declare the level count before setting leveled fields.

| Object | Supported setters |
| --- | --- |
| Unit | `name(string)`, `tooltip(string)`, `extendedTooltip(string)`, `model(string)`, `scale(number)`, `hitPoints(number)`, `movementSpeed(number)`, `abilities(number[])` |
| Ability | `name(string)`, `hero(boolean)`, `levels(number)`; `tooltip`, `extendedTooltip`, `manaCost`, `cooldown`, `targets` take the level first |
| Blizzard (`AHbz`) | `blizzardWaves(level, number)` writes Data A; `blizzardDamage(level, number)` writes Data B |

Targets are typed words: `air`, `ground`, `enemy`, `friend`, `self`, `neutral`,
`organic`, `mechanical`, `structure`, `hero`, `nonhero`, `vulnerable`,
`invulnerable`. Wrong setter value types fail TypeScript checking; integers,
finite float values, levels, columns and rawcodes are checked before encoding.
New IDs must be four printable ASCII characters encoded as a numeric rawcode.
Duplicate new IDs in the same object file, including `$wsl`, fail before
packaging. Fields outside this subset still use low-level `Modification`.

# Binary format

`encodeObjectData` writes Warcraft object format 2: version, stock-object
count zero, custom-object count, then each base/new ID and its modifications.
Unit and item fields have no level or column. Ability, buff and upgrade
fields store a level and `dataColumn` after the value type; ordinary fields
use column zero and Data A/B/... use columns 1/2/.... Every modification ends
with four zero bytes.

| `ObjectValue.kind` | Binary type | Payload |
| --- | --- | --- |
| `int` | 0 | Signed 32-bit integer, little endian |
| `real` | 1 | Binary32 float, little endian |
| `unreal` | 2 | Binary32 float, little endian; retains the editor's distinct type |
| `string` | 3 | UTF-8 text followed by a null byte |

For example, the sample writes Blizzard's damage as field `Hbz2`, type 2,
column 2: level 1 is 10, level 2 is 20. Its waves use `Hbz1`, type 0, column
1: two and four. Cooldown uses `acdn`, type 2, column zero: three and six.
`bun test test/object-data.test.ts` reads both files with an independent
decoder and compiles six wrong-type fixtures.

The sample's unit and two-level ability take **9 authored lines**, excluding
imports and packaging. The equivalent raw arrays need **32 lines** when
each of their 24 modification records is one line and each object has four
wrapper lines. This compares the same fields, IDs and values.

The sample build on 8 October 2026 generated its object files in **1.712 ms**
and completed the map in **3.332 s**. The build prints `object generation`
before packaging; this measurement includes encoding both custom objects
and FileIO's ability.

Field IDs, editor value types and data-column numbers were checked against
WurstStdlib2 `e3714f629113ee682353c3244065fee3e7d9ae16`,
`wurst/objediting/UnitObjEditing.wurst` and `AbilityObjEditing.wurst`, licensed
Apache-2.0. The facts above informed this original TypeScript implementation;
no Wurst code, generated setters or expressions were copied or adapted.
See [the toolchain comparison](comparison.md#reuse-rights).
