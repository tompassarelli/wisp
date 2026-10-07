import project from "./project";

export default {
  ...project,
  roster: { ...project.roster, policies: [["clean", "clean"], ["fuzz", "desync"]] },
};
