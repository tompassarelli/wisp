// The soak's tests' declaration of the test map.
import { join } from "node:path";
import { defineSoak } from "../../scripts/wisp/soak";

export default defineSoak({
  name: "soak test",
  map: { filePrefix: "soaktest", globalPrefixes: ["__soakTest"] },
  game: join(import.meta.dir, "game.ts"),
  roster: { fighters: ["a", "b"], stages: ["flat"], policies: [["fuzz", "fuzz"], ["fuzz", "freeze"]] },
  controller: { buttons: ["jump", "attack", "start"], toggles: ["start"], axes: ["x", "y"], axisLimit: 127, deadZone: 10 },
  frames: 600,
  matches: 4,
});
