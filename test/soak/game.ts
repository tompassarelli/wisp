// How the soak's tests set up a match of the test map: each policy but
// "fuzz" switches on a fault, and every controller edge is counted. A
// "typing" player's helper types a 600-character burst every two seconds.
// "loop" is the game's own detector finding something from tick 200 on.
import { defineSoakGame } from "../../scripts/wisp/soak";
import { reproLines } from "../../src/runtime/repro";
import { LAST_TICK, install, start, state } from "./map";

export default defineSoakGame({
  entry: { start, install },
  begin: (clients, match) => {
    clients.everywhere(() => {
      const s = state();
      s.frozen = match.policies.includes("freeze");
      s.desync = match.policies.includes("desync");
      s.throwing = match.policies.includes("throw");
      s.heavyMs = match.policies.includes("heavy") ? 0.3 : 0;
    });
    let frame = 0;
    return {
      input: ({ edges, frame: next }) => {
        frame = next;
        for (const client of clients.clients) {
          client.run(() => {
            for (const [slot, changes] of edges) state().edges[slot] = (state().edges[slot] ?? 0) + changes.length;
          });
        }
      },
      typed: (slot) => (match.policies[slot] === "typing" && frame % 120 === 60 ? 600 : 0),
      observe: () => {
        const { tick } = state();
        return { progress: tick >= LAST_TICK ? undefined : tick, over: tick >= LAST_TICK };
      },
      confirmed: () => ({ frame: state().tick, checksum: `${state().tick}:${state().edges.join(",")}:${state().keys.join(",")}` }),
      findings: () => {
        const { tick } = state();
        return match.policies.includes("loop") && tick >= 200 ? [{ detector: "loop", text: `tick ${tick} repeats tick ${tick - 50}` }] : [];
      },
      repro: () => reproLines({ build: "soak-test", frame: state().tick, checksum: String(state().tick) }, [`edges ${state().edges.join(" ")}`]),
    };
  },
});
