# Native clients

`wisp client` owns screen input, passive state and recovery for the clients
declared by the game. `wisp client look`, `wisp client read`, `wisp client click`,
`wisp client keys` and `wisp client chat` use that client's private desktop.

Every `wisp client` action reads the clients file the game passes to
`makeClient`, which the sample takes from `WISP_CLIENTS`. `--clients-file FILE`,
anywhere in the arguments, names another file for that run, such as the LAN
pool's `~/.local/state/wisp/lan/clients.json`. An option the action does not
define fails with a usage error that names it.

`wisp client watch [CLIENT...] [--once] [--json] [--record FILE]` reads its
events; `wisp client wait CLIENT STATE... [--seconds N]` waits for a state.
See [watching clients](watch.md).

`wisp client doctor [CLIENT...]` brings named clients, or all clients, to a
ready state. The game supplies its recovery command as the third argument
to `makeClient(clientsFile, watchOptions, doctorCommand, signOutCommand)`; see
[client recovery](doctor.md). Doctor signs a launcher in with the client's
declared account. `wisp client sign-out CLIENT...` signs clients out (the
fourth argument, from `makeSignOut`); the next doctor run signs them in again.
The sample map has no account recovery declaration.

`wisp client start [CLIENT...]` starts each client's private desktop and
Battle.net as user services that outlive the command and its caller, runs
doctor and returns at the menu; `wisp client status [CLIENT...]` names the
service behind each, and `wisp client stop [CLIENT...]` stops them. See
[clients as services](doctor.md#clients-as-services).

## Shared game storage

`wisp client share BASE INSTALL...` makes each INSTALL's `Data/` and
`_retail_` a view of BASE's: every file there becomes a hardlink to BASE's,
and a file BASE lacks, such as an older `.idx` version, is removed, because a
storage mixing its own indices with another copy's archives is corrupt. Every
install must be on BASE's build (version and build key); the share refuses
otherwise, and while a client runs in any of them. The game writes only its
storage's `shmem` files while it runs (on gex45 from 24 to 28 October 2026,
no other storage or `_retail_` file in three signed-in clones or the LAN pool
changed), so those stay each install's own, refreshed from BASE's whenever the
storage changes, as do the menu page (`_retail_/webui/index.html`) and
everything outside `Data/` and `_retail_`: configuration, Documents,
CustomMapData, logs and caches. Shared
files stay writable: the game opens its storage for writing and stops with
`E_STORAGE_INIT` when every storage file is read-only and `E_REPAIR` when
only the `data.NNN` archives are (gex45, 28 October 2026). Hardlinks need one filesystem; on btrfs, where
`cp --reflink` already shares the blocks, there is nothing to gain.

Battle.net updates an install by writing into its storage, so `client start`
and `client doctor` first read the live build from the patch CDN and give
any signed-in client (one whose prefix has `Battle.net Launcher.exe`) that is
behind it and shares storage a private copy of each shared file, so the
update never writes into its siblings' files.
Once they are all on the new build, run `client share` with one of them as
BASE again. LAN pool clients share their source's storage the same way through
[`lan setup`](lan.md) and never update.

## Remote native runs

`bun wisp native remote` stages a native run on an SSH host and copies its
results to `~/.local/state/smashcraft/RUN/`. The VM already has the game's
project, Bun, Wisp, its private inputs and ready clients. Use an SSH alias
configured with its existing key and port; the runner uses batch authentication.
Its clients file must name paths and services on the VM.

```sh
bun wisp native remote --host warcraft-vm --project /home/tom/code/smashcraft/ts \
  --map build/map.w3x --pads pads --clients-file clients-vm.json --run ko-001 \
  --dry-run -- pad pads/ko-bottom.pad --map build/map.w3x \
  --clients-file clients-vm.json --out '{out}'
```

Remove `--dry-run` to execute. Everything after `--` is passed to the VM's
`bun wisp`. The example runs the game's `pad` command. The local map, pads
directory and clients file are copied with rsync over SSH to the project's
`.wisp/native/RUN/inputs/`; source files stay unchanged. Command arguments
matching those input paths are replaced with their remote paths, including
files within the pads directory. Existing `--map`, `--clients-file` and `--out`
flags (also `--flag=value`) receive the staged map, VM clients file and remote
output directory. Flags are never added to the forwarded command.

Arguments can also use `{map}`, `{pads}`, `{clients}` and `{out}` explicitly;
`{pads}/ko-bottom.pad` names a staged pad. Shell-quote placeholders locally.
The command runs from `--project`, an absolute VM path. The game decides which
native commands and output flags it supports. Commands without an output flag
still retain `stdout.log` and `stderr.log` in the results folder.

`--run` is a new single folder name. Existing local or remote runs are refused.
The dry-run prints the six exact shell commands: remote directory creation,
three uploads, the remote command and the results download. It starts no
processes and reads no input files. Remote stdout and stderr are retained and
printed after the command finishes; results are downloaded even when that
command fails, then its failure is reported. An interrupted connection leaves
the private remote run folder available for recovery.

Consumers can register the reusable command as
`native: { usage: "remote ... -- WISP_ARGS", load: async () =>
(await import("wisp/scripts/wisp/commands/nativeRemote")).nativeRemote }`
in their `runMainCli` command table.
