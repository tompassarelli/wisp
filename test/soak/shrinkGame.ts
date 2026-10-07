import { defineSoakGame } from "../../scripts/wisp/soak";
import game from "./game";

export default defineSoakGame({
  ...game,
  begin: (clients, match) => {
    const driver = game.begin(clients, match);
    let first = false, second = false;
    return {
      ...driver,
      input: step => {
        driver.input(step);
        for (const [, edges] of step.edges) for (const edge of edges) {
          if (!("button" in edge) || !edge.down) continue;
          if (edge.button === 0) first = true;
          if (edge.button === 1) second = true;
        }
      },
      findings: () => first && second ? [{ detector: "two-inputs", text: "both required presses arrived" }] : [],
    };
  },
});
