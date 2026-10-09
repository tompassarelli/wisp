import { Effect, Schema } from "effect";

class PanelFailure extends Schema.TaggedError<PanelFailure>()("PanelFailure", { cause: Schema.Unknown }) {
  override get message() { return String(this.cause); }
}


export function panelServer(port: number, fetch: (request: Request) => Response | Promise<Response>) {
  return Effect.acquireRelease(Effect.try({ try: () => Bun.serve({ hostname: "127.0.0.1", port, fetch(request) {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    if (host !== `127.0.0.1:${url.port}` && host !== `localhost:${url.port}`) return Response.json({ error: "the panel answers only its own address" }, { status: 403 });
    return fetch(request);
  } }), catch: cause => new PanelFailure({ cause }) }), server => Effect.promise(() => server.stop(true)));
}
