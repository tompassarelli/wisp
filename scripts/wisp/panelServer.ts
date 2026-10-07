/** Shared loopback server for the tuning and repro panels. */
export function panelServer(port: number, fetch: (request: Request) => Response | Promise<Response>) {
  return Bun.serve({ hostname: "127.0.0.1", port, fetch(request) {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    if (host !== `127.0.0.1:${url.port}` && host !== `localhost:${url.port}`) return Response.json({ error: "the panel answers only its own address" }, { status: 403 });
    return fetch(request);
  } });
}
