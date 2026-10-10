# Fidelity capture format

Each reference or candidate directory contains `manifest.json`. The public
validator in `scripts/wisp/fidelity/manifest.ts` exports `readManifest(directory)`
and `decodeManifest(unknown)` as Effect programs. Provide `BunServices.layer` when
reading files. `bun wisp fidelity check` validates both directories before any
comparison. The file-format acceptance check runs with
`bun run test test/fidelity-manifest.test.ts` on public synthetic inputs.

Version 1 has a frozen `split` and a nonempty `slices` array. Freeze the split
before fitting: `frozenAt` is its timestamp; `fit`, `heldOut` and `retired` are
disjoint scene-name arrays. Each slice declares its matching `split` membership.
After consulting a held-out scene for fitting, move it to `retired` in the
authoritative split and re-record a replacement. Gate comparisons refuse fit
and retired slices. The validator checks the recorded partition; its owner must
preserve the original frozen split outside the capture directory.

A slice identifies a `lever`, `scene`, `kind` (`lever` or `stage`), `pad`, `look`
(`classic` or `definitive`), unique integer `frames`, and a camera with
`position`, `target` and degree `fov`. Its `identity` records the native `build`,
ordered `assetLayers`, `mapHash`, `settingsFile`, pixel `resolution` (width and
height), and `gpu`. The look and each capture's frame are also part of frame
identity. Record real values on the VM; never copy synthetic fixture values
into native references. Keep installed assets and native images outside Git.

`settings` maps numeric lever settings to their values. `calibratedRanges` maps
the same nonempty keys to finite inclusive `min` and `max` bounds. Captures may
record values outside calibration, but the fidelity gate refuses them. Metric
`regions` have unique IDs, integer x/y/width/height, and a `critical` boolean;
all regions must fit inside the recorded resolution.

Each control has a unique `id`, a `mode` (`stock`, `mask` or `stage`), booleans
`fog`, `bloom` and `cine`, and a numeric `dof`. Each slice includes all three
modes, fog on/off, bloom on/off, at least three DOF values, and cine on/off.
`cineWindow` records inclusive start/end frames; every frame in it must appear
in the slice's frame list. Use matched controls that vary one setting at a time
to isolate each effect.

Each slice records at least three independently acquired runs with unique
`id`s. Every run lists `captures` for every declared frame/control pair, each
with `frame`, `control` ID and a distinct relative `image` path inside the
directory. Duplicate pairs, undeclared controls/frames and omitted captures
are rejected. The gate reads the images; manifest validation only checks the
declared capture inventory.

`test/fixtures/fidelity-manifest/manifest.json` is a complete synthetic example:
one scene, two frames, eight controls, three runs and 48 image paths. It contains
no private captures, calibrated native values, asset data or image payloads.
The same schema accepts a per-lever slice first and a larger stage collection
later; scenes omitted from a per-lever directory can remain in the frozen split.
