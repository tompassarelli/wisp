import { expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { decodeDesyncSummary, divergedValues } from "../scripts/wisp/desyncs";

// The observed Desync.txt grammar, without the machine description around it.
// Values are those of a native reload desync: one client allocated one more handle.
const report = (birthTag: string, tempest: string, closed = true) => [
  "<Application>Warcraft III",
  "<Exception.BuildNumber>24268",
  "",
  "<Exception.Summary:>",
  "Network desync on turn 12585 in game W3-00000000-0000-0000-0000-000000000000",
  "<:Exception.Summary>",
  "<Exception.Assertion:>",
  "War3 build 7000",
  `War3 next presence tag 04406 next birth tag ${birthTag}`,
  `War3 tempest checksum ${tempest}`,
  "War3 net checksum 76e87acc",
  "War3 rand checksum 4dd420d8",
  "War3 custom unit checksum 571c6fc3",
  "",
  ...(closed ? ["<:Exception.Assertion>", "<Exception.HashBlock:>", "Network desync on turn 12585 in game W3-00000000-0000-0000-0000-000000000000", "<:Exception.HashBlock>", "", "<PlayerCount> 2", ""] : []),
].join("\r\n");
const A = report("08102", "cb35df6c");
const B = report("08103", "cbb742b8");

const decode = (text: string) => Effect.runPromise(decodeDesyncSummary("Desync.txt", text));

test("[native] Warcraft desync summaries name each diverged engine value with every client's value", async () => {
  const [a, b] = [await decode(A), await decode(B)];
  expect(a?.turn).toBe(12585);
  expect(a?.values).toContainEqual(["custom unit checksum", "571c6fc3"]);
  expect(divergedValues(a === undefined || b === undefined ? [] : [a, b])).toEqual([
    { name: "next birth tag", values: ["08102", "08103"] },
    { name: "tempest checksum", values: ["cb35df6c", "cbb742b8"] },
  ]);
  expect(divergedValues(a === undefined ? [] : [a, a])).toEqual([]);
  expect(await decode(report("08102", "cb35df6c", false))).toBeUndefined();
  const malformed = await Effect.runPromiseExit(decodeDesyncSummary("Desync.txt", A.replaceAll("on turn 12585", "on turn x")));
  expect(Exit.isFailure(malformed)).toBe(true);
});
