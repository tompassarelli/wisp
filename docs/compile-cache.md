# Compile and archive caches

`map build` and `map rebuild` keep two caches under `$WISP_COMPILE_CACHE`
(default `~/.cache/wisp/compile`), so a fresh process or a fresh checkout
redoes only the work its changes need ([compiler](../host/toolchain/compiler.ts),
[cache](../host/toolchain/compileCache.ts), [map build](../host/compile/mapBuild.ts);
wisp:host/toolchain/compiler.ts, wisp:host/toolchain/compileCache.ts,
wisp:host/compile/mapBuild.ts).

## Compile cache

After each successful compile with no replaced sources, the compiler saves
TypeScript's incremental build info and each module's Lua text and source-map
tree, one content-addressed file per module and an index. The next compile of
the same configuration restores them: TypeScript compares file contents with
the saved state and type-checks and transpiles only the files it marks
affected, the same set the in-process incremental compiler uses, and every
other module comes from disk. Paths are stored relative to the configuration's
directory, so another checkout of the project at another commit reuses the
cache. The key covers the compiler options, the root files, the bytes of every
module the compiler, Wisp's plugins and the project's plugins import, followed
into other packages, and of the data files TypeScriptToLua and source-map read
at run time (the lualib and the source-map wasm); any change starts a new
cache. Plugins resolve as TypeScriptToLua resolves them. The lockfile is
not part of it, so a Wisp bump that changes only files the compiler never
loads keeps the cache: on Smashcraft (23 Oct 2026) a bump touching only the
LAN pool built in 9.2 s instead of 30.8 s, and a bump touching a compiler file
still compiled cold. Only modules that changed are written again, and the
eight most recently used caches stay.

The result equals a full TypeScriptToLua compile byte for byte, bundle and
source map (wisp:test/compiler.test.ts). On Smashcraft (950 modules, 19 Oct
2026) a commit's build after another commit's cache compiled in 16.5 s instead
of 29.3 s, and a one-file edit in 13 s; the bundle and source map matched the
cold build.

A script that is still current (no compile input newer than its bundle) is
reused without compiling.

## Archive cache

A build packs the base map's files and the declared imports into the container
once per distinct content and keeps the result under `archives/`, keyed by a
hash of the container and every entry's name and bytes; the three most
recently used archives stay. Each build copies the archive, replaces only the
generated files (script, map info, object data) and writes the header, then
verifies those files' bytes and that every packed entry is listed. On
Smashcraft packaging and verification fell from 8.4 s to 0.5 s, and every
one of the 743 entries and the header matched a full pack.

## Map reuse

A game that builds one map for many workers wraps its build in
`reuseOrBuild` ([map reuse](../host/compile/mapReuse.ts); wisp:host/compile/mapReuse.ts).
The caller keys the build with `mapReuseKey`, the hash of exactly the inputs
it names (its tree, `wisp.lock`, the build-input pins, the profile, the
edition and the map's name), and the first caller to hold the key's lock builds
and stores the map and its `.base.lua`. Every later caller with the same key
waits for that lock, copies the stored map and logs `reused map build KEY`. The
store is `$WISP_MAP_REUSE_STORE` (default `~/.cache/wisp/maps`), so every worker
on the host reads it; it holds at most `$WISP_MAP_REUSE_GIB` (default 8) GiB,
and the least recently used builds go first. A key missing here is first
copied over ssh from each destination `$WISP_MAP_REUSE_PEERS` names (space or
comma separated, such as `tom@gex45`) that has it stored, into this store under
the same key, logging `copied map build KEY from PEER` before `reused map build
KEY`; an unreachable peer, or one without the key, leaves the build to run here.
