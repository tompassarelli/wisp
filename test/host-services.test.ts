import { expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { preloadRecord } from "../scripts/wisp/preloadRecord";

test("[property seed 94905] Preload assignments preserve text between independently generated numeric fields", async () => {
  const kind = preloadRecord({ head: ["received-mask={mask} reason={reason} sequence={sequence} frame={frame}"] }, Schema.Struct({ mask: Schema.FiniteFromString, reason: Schema.NonEmptyString, sequence: Schema.FiniteFromString, frame: Schema.FiniteFromString }));
  let seed = 94905;
  for (let sequence = 0; sequence < 64; sequence++) {
    seed = Math.imul(seed, 1664525) + 1013904223;
    const mask = seed >>> 0;
    const reason = ["input submission failed", "waiting for both clients", "received-mask key intact"][sequence % 3]!;
    const frame = sequence * 417;
    const text = 'function PreloadFiles takes nothing returns nothing\ncall Preload( "received-mask=' + mask + ' reason=' + reason + ' sequence=' + sequence + ' frame=' + frame + '" )\nendfunction\n';
    expect(await Effect.runPromise(kind.decode("seed-94905-" + sequence + ".pld", text))).toEqual({ mask, reason, sequence, frame });
  }
});
