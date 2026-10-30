import { expect, test } from "bun:test";
import { type Facts, type Routing, chooseRunner } from "../host/farm/runnerRoute";

const routing: Routing = { premerge: "farm-big", background: "farm-big", hosted: "ubuntu-latest", capacity: 2 };
const facts = (over: Partial<Facts>): Facts => ({ event: "push", attempt: 1, override: "", want: 1, busy: 0, ...over });

test("[property] an owner push, dispatch or schedule takes the farm while a runner is idle", () => {
  for (const event of ["push", "workflow_dispatch", "schedule"]) expect(chooseRunner(routing, "premerge", facts({ event, busy: 1 })).runner).toBe("farm-big");
});

test("[property] fork-capable and unknown events never take the farm, even with the override", () => {
  for (const event of ["pull_request", "pull_request_target", "workflow_run", "issue_comment"]) {
    expect(chooseRunner(routing, "background", facts({ event })).runner).toBe("ubuntu-latest");
    expect(chooseRunner(routing, "background", facts({ event, override: "farm-big" })).runner).toBe("ubuntu-latest");
  }
});

test("[property] a saturated farm, or one too busy for the wanted jobs, falls back to hosted runners", () => {
  expect(chooseRunner(routing, "background", facts({ busy: 2 })).runner).toBe("ubuntu-latest");
  expect(chooseRunner(routing, "background", facts({ busy: 5 })).runner).toBe("ubuntu-latest");
  expect(chooseRunner(routing, "background", facts({ busy: 1, want: 2 })).runner).toBe("ubuntu-latest");
  expect(chooseRunner(routing, "background", facts({ busy: 0, want: 2 })).runner).toBe("farm-big");
});

test("[property] a retry goes hosted and a dispatch override wins on a trusted event", () => {
  expect(chooseRunner(routing, "premerge", facts({ attempt: 2 })).runner).toBe("ubuntu-latest");
  expect(chooseRunner(routing, "premerge", facts({ override: "ubuntu-latest" })).runner).toBe("ubuntu-latest");
  expect(chooseRunner(routing, "premerge", facts({ override: "farm-test" })).runner).toBe("farm-test");
});
