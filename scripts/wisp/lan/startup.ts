/** A failed first-client check must finish before the peer can be launched. */
export async function startPairClients<T>(clients: readonly T[], start: (client: T) => Promise<void>, locateFirst?: (client: T) => Promise<void>): Promise<void> {
  for (const [index, client] of clients.entries()) {
    await start(client);
    if (index === 0 && locateFirst !== undefined) await locateFirst(client);
  }
}

export async function waitForFirstClient(ready: () => boolean, stopped: () => boolean, pause: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (stopped()) throw new Error("the first client's native launcher stopped before Warcraft started");
    if (ready()) return;
    await pause();
  }
  throw new Error("the first Warcraft process did not start within 60 s");
}
