# Native clients

`wisp client` owns screen input, passive state and recovery for the clients
declared by the game. `wisp client look`, `wisp client read`, `wisp client click`,
`wisp client keys` and `wisp client chat` use that client's private desktop.

`wisp client watch [CLIENT...] [--once] [--json] [--record FILE]` reads its
events; `wisp client wait CLIENT STATE... [--seconds N]` waits for a state.
See [watching clients](watch.md).

`wisp client doctor [CLIENT...]` brings named clients, or all clients, to a
ready state. The game supplies its recovery command as the third argument
to `makeClient(clientsFile, watchOptions, doctorCommand)`; see
[client recovery](doctor.md). The sample map has no account recovery declaration.
