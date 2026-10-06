// How the soak's tests set up a match of the test map: each policy but
// "fuzz" switches on a fault, and every controller edge is counted.
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
    return {
      input: ({ edges }) => {
        for (const client of clients.clients) {
          client.run(() => {
            for (const [slot, changes] of edges) state().edges[slot] = (state().edges[slot] ?? 0) + changes.length;
          });
        }
      },
      observe: () => {
        const { tick } = state();
        return { progress: tick >= LAST_TICK ? undefined : tick, over: tick >= LAST_TICK };
      },
      confirmed: () => ({ frame: state().tick, checksum: `${state().tick}:${state().edges.join(",")}:${state().keys.join(",")}` }),
      repro: () => reproLines({ build: "soak-test", frame: state().tick, checksum: String(state().tick) }, [`edges ${state().edges.join(" ")}`]),
    };
  },
});
