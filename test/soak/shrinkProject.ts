import { join } from "node:path";
import { defineSoak } from "../../host/soak/soak";
import project from "../../host/soak/ci/project";

export default defineSoak({ ...project, game: join(import.meta.dir, "shrinkGame.ts") });
