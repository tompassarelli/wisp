import { expect, test } from "bun:test";
import { joinOrDispatch } from "../host/checks/autolandQueue";

test("[spec wisp autoland-queue] a pushed branch dispatches a new queue run when every waiting one is past reading its members", () => {
  expect(joinOrDispatch([{ id: 1, rebase: "in_progress" }])).toEqual({ action: "dispatch" });
  expect(joinOrDispatch([{ id: 2, rebase: "completed" }])).toEqual({ action: "dispatch" });
});
