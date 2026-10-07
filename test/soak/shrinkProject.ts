import { join } from "node:path";
import { defineSoak } from "../../scripts/wisp/soak";
import project from "./project";

export default defineSoak({ ...project, game: join(import.meta.dir, "shrinkGame.ts") });
