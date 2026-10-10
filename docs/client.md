# Native clients

`wisp client` owns screen input, passive state and recovery for the clients
declared by the game. `wisp client look`, `wisp client read`, `wisp client click`,
`wisp client keys` and `wisp client chat` use that client's private desktop.

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
