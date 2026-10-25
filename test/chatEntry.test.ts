import { expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { chatEntryBand, chatEntryOpen, sendCheckedChat } from "../host/os/warcraft/chatEntry";

const GOLD = [229, 177, 13] as const;
const WHITE = [230, 230, 230] as const;

const band = (rows: readonly { readonly y: number; readonly from: number; readonly to: number; readonly color: readonly [number, number, number] }[]) => {
  const width = 800;
  const height = 72;
  const rgb = new Uint8Array(width * height * 3).fill(20);
  for (const row of rows) for (let x = row.from; x < row.to; x++) rgb.set(row.color, (row.y * width + x) * 3);
  return { width, height, rgb };
};

const { minRun } = chatEntryBand({ x: 0, y: 0, width: 800, height: 600 });

test("[property] the chat entry reads open only with two long gold border rows, as Warcraft draws it at 800x600", () => {
  expect(chatEntryOpen(band([{ y: 24, from: 205, to: 600, color: GOLD }, { y: 49, from: 205, to: 600, color: GOLD }]), minRun)).toBe(true);
  expect(chatEntryOpen(band([{ y: 24, from: 205, to: 600, color: GOLD }]), minRun)).toBe(false);
  expect(chatEntryOpen(band([{ y: 24, from: 205, to: 600, color: WHITE }, { y: 49, from: 205, to: 600, color: WHITE }]), minRun)).toBe(false);
  expect(chatEntryOpen(band([{ y: 24, from: 205, to: 340, color: GOLD }, { y: 49, from: 205, to: 340, color: GOLD }]), minRun)).toBe(false);
});

const rig = (states: { readonly afterReturn: boolean; readonly afterLine: boolean }) => {
  let open = false;
  const sent = { returns: 0, lines: 0 };
  const steps = {
    open: Effect.sync(() => open),
    pressReturn: Effect.sync(() => { sent.returns++; open = states.afterReturn; }),
    sendLine: Effect.sync(() => { sent.lines++; open = states.afterLine; }),
    seconds: 0.2,
  };
  return { sent, run: Effect.runPromiseExit(sendCheckedChat({ name: "lan0a" }, steps)) };
};

const failure = (exit: Exit.Exit<void, { readonly message: string }>) => (Exit.isFailure(exit) ? String(exit.cause) : "succeeded");

test("[scenario] a Return the game never sees fails the chat before any text is typed", async () => {
  const { sent, run } = rig({ afterReturn: false, afterLine: false });
  expect(failure(await run)).toContain("stayed closed");
  expect(sent).toEqual({ returns: 1, lines: 0 });
});

test("[scenario] a chat entry still open after the closing Return fails as an unsent line", async () => {
  const { sent, run } = rig({ afterReturn: true, afterLine: true });
  expect(failure(await run)).toContain("the line was not sent");
  expect(sent).toEqual({ returns: 1, lines: 1 });
});

test("[scenario] an entry that opens on Return and closes on the line succeeds", async () => {
  const { sent, run } = rig({ afterReturn: true, afterLine: false });
  expect(Exit.isSuccess(await run)).toBe(true);
  expect(sent).toEqual({ returns: 1, lines: 1 });
});
