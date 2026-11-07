import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeControl, encodeControl, type RelayControl } from "../host/net/relayControl";

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const unhex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));

const vectors = readFileSync(join(import.meta.dir, "../relay/relay-proto/vectors/control.txt"), "utf8")
  .split("\n")
  .filter((line) => line !== "" && !line.startsWith("#"))
  .map((line) => {
    const [type = "", ...fields] = line.split(" ");
    const values = new Map(fields.map((field) => [field.slice(0, field.indexOf("=")), field.slice(field.indexOf("=") + 1)]));
    const message: Record<string, unknown> = { type };
    for (const [key, value] of values) {
      if (key === "hex") continue;
      message[key] = ["cookie", "request", "room", "token"].includes(key) ? BigInt(value) : ["steps", "payload"].includes(key) ? unhex(value) : key === "reason" ? value : Number(value);
    }
    return { line, message: message as unknown as RelayControl, packet: unhex(values.get("hex") ?? "") };
  });

describe("relay control vectors", () => {
  test("[boundary] every vector line encodes to its packet and its packet decodes back, the same bytes the Rust codec checks", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(20);
    for (const { line, message, packet } of vectors) {
      expect(hex(encodeControl(message)), line).toBe(hex(packet));
      expect(decodeControl(packet), line).toEqual(message);
    }
  });
});
