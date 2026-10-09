# Declared unit models and scales

`MapBuild.build()` accepts an opt-in `unitModels` check for map-declared
Classic and Definitive models. The consumer supplies the intended paths and
scales alongside the object-data definitions it builds:

```ts
yield* maps.build({
  ...buildOptions,
  unitModels: {
    scaleTolerance: 0.1,
    units: [{
      id: "u097",
      classic: { path: "Models\\Classic.mdx", scale: 1 },
      definitive: { path: "Models\\Definitive.mdx", scale: 1.05 },
    }],
  },
  localModels: [
    { entry: "Models\\Classic.mdx", source: "/private/models/classic.mdx" },
    { entry: "Models\\Definitive.mdx", source: "/private/models/definitive.mdx" },
  ],
});
```

`localModels` maps in-game paths to user-owned files available locally; it
does not import those files. Base-map files and declared imports are checked
as well, with packaged entries taking precedence over local entries. Path
matching ignores case, accepts either slash, and resolves `.mdl` references
to `.mdx`. A missing file fails the build with unit ID, mode and unresolved
path. A complete pair passes this resolution check.

`scaleTolerance` is an absolute difference in declared scale units, not a
percentage. `abs(classic.scale - definitive.scale) > scaleTolerance` fails;
the report names the unit, both values, difference and tolerance. Scales
must be finite and positive; tolerance must be finite and nonnegative.

This checks declarations and file availability. Native texture resolution
and fallback are separate ([#91](https://github.com/tompassarelli/wisp/issues/91));
lighting and graphics fidelity are separate ([#79](https://github.com/tompassarelli/wisp/issues/79)).
The check does not decode models or infer their on-screen size.

## A particular World Editor save

`compareUnitModels(before, after)` returns changed fields with unit ID,
mode, `path` or `scale`, and both observed values. Keep the actual map pair
and any extracted object data in private storage. Derive the two declarations
from that pair's actual object fields, then compare them. Added or removed
units report their mode fields with the absent value `undefined`.

The synthetic comparison test exercises reporting only; it is not a World
Editor save observation. Issue [#97](https://github.com/tompassarelli/wisp/issues/97)
still needs one retained real save pair. Its reference setup is a source-owned
unit `u097` with the paths and scales above, opened and saved once in World
Editor; retain the map before and after saving, the Editor build and the
observed mode fields. That observation applies to that save pair only.
