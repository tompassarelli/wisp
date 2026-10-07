/** A failed first-client check must finish before the peer can be launched. */
export async function startPairClients<T>(clients: readonly T[], start: (client: T) => Promise<void>, locateFirst?: (client: T) => Promise<void>): Promise<void> {
  for (const [index, client] of clients.entries()) {
    await start(client);
    if (index === 0 && locateFirst !== undefined) await locateFirst(client);
  }
}
