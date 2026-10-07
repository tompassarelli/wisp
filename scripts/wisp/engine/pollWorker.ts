// The autopsy's presence poller thread (wisp:scripts/wisp/engine/autopsy.ts):
// startPresencePoll every 2 ms off the session's own thread, so a runner's
// timed input (pad scripts spin to their frame times) keeps its timing.
import type { EngineClient } from "./attach";
import { type PresencePoll, startPresencePoll } from "./poll";

declare const self: Worker;

type Message =
  | { readonly kind: "start"; readonly clients: readonly EngineClient[]; readonly out: string; readonly interval: number }
  | { readonly kind: "stop" };

let running: PresencePoll | undefined;

self.onmessage = async (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.kind === "start") running = startPresencePoll(message.clients, { out: message.out, interval: message.interval });
  else {
    const summaries = running === undefined ? [] : await running.stop();
    self.postMessage({ kind: "stopped", summaries });
  }
};
