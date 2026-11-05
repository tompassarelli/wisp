import { expect, test } from "bun:test";
import { joinOrDispatch } from "../host/checks/autolandQueue";

test("[spec wisp autoland-queue] a pushed branch dispatches a queue run when none is waiting", () => {
  expect(joinOrDispatch([])).toEqual({ action: "dispatch" });
});

test("[spec wisp autoland-queue] a pushed branch joins a queue run that has not yet read its members", () => {
  expect(joinOrDispatch([{ id: 7, rebase: null }])).toEqual({ action: "join", run: 7 });
  expect(joinOrDispatch([{ id: 8, rebase: "queued" }])).toEqual({ action: "join", run: 8 });
  expect(joinOrDispatch([{ id: 1, rebase: "completed" }, { id: 9, rebase: "waiting" }])).toEqual({ action: "join", run: 9 });
});

test("[spec wisp autoland-queue] a pushed branch dispatches a new queue run when every waiting one is past reading its members", () => {
  expect(joinOrDispatch([{ id: 1, rebase: "in_progress" }])).toEqual({ action: "dispatch" });
  expect(joinOrDispatch([{ id: 2, rebase: "completed" }])).toEqual({ action: "dispatch" });
});
