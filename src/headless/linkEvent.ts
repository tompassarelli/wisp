import type { HeadlessClient } from "./client";
import type { PlayerMouseInput } from "./clientTypes";

export type LinkEvent =
  | { readonly sender: number; readonly kind: "sync"; readonly prefix: string; readonly data: string }
  | { readonly sender: number; readonly kind: "key"; readonly key: number; readonly meta: number; readonly down: boolean }
  | { readonly sender: number; readonly kind: "mouse"; readonly mouse: PlayerMouseInput }
  | { readonly sender: number; readonly kind: "chat"; readonly text: string }
  | { readonly sender: number; readonly kind: "click"; readonly frame: number }
  | { readonly sender: number; readonly kind: "wheel"; readonly frame: number; readonly value: number };

/** Runs one player's input event on a client, as Warcraft runs a turn's events. */
export function applyLinkEvent(client: HeadlessClient, event: LinkEvent): void {
  if (event.kind === "sync") client.deliverSync({ sender: event.sender, prefix: event.prefix, data: event.data });
  else if (event.kind === "key") client.keyEvent(event.sender, event.key, event.meta, event.down);
  else if (event.kind === "mouse") client.playerMouse(event.sender, event.mouse);
  else if (event.kind === "chat") client.chat(event.sender, event.text);
  else if (event.kind === "wheel") client.frameEvent(event.sender, event.frame, client.constants.FRAMEEVENT_MOUSE_WHEEL, event.value);
  else client.frameEvent(event.sender, event.frame, client.constants.FRAMEEVENT_CONTROL_CLICK, 0);
}
