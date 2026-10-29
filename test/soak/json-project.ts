import project from "../../host/soak/ci/project";

export default {
  ...project,
  roster: { ...project.roster, policies: [["clean", "clean"], ["fuzz", "desync"]] },
};
