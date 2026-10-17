import type { HeadlessClient } from "./client";

export function point(client: HeadlessClient, x: number, y: number, left: boolean | undefined): void {
  client.mouseScreenX = x;
  client.mouseScreenY = y;
  if (left === true) client.heldMouseButtons.add(client.natives.MOUSE_BUTTON_TYPE_LEFT);
  else if (left === false) client.heldMouseButtons.delete(client.natives.MOUSE_BUTTON_TYPE_LEFT);
}
