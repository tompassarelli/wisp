import project from "./project";

// Wisp's own `bun wisp ci` soak: the soak test's map with fault-free policies only.
export default {
  ...project,
  roster: { ...project.roster, policies: [["fuzz", "fuzz"], ["fuzz", "cpu"]] },
};
