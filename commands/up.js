const { resolve } = require("path");
module.exports = {
  name: "kind-up",
  alias: ["kup"],
  run: async ({ print, system, kindConfig }) => {
    const { cluster, rootDir } = kindConfig;
    const { clusterName } = cluster;

    if (!cluster) {
      print.error("devctl-kind is not yet initialized on this cluster.");
      return -1;
    }

    try {
      const execing = print.spin(`Creating cluster ${clusterName}`);
      await system.run(
        `kind create cluster --name ${clusterName} --config ${resolve(
          rootDir,
          ".devctl-kind.config.yaml"
        )}`
      );
      execing.succeed(`Cluster created!`);
    } catch (e) {
      print.error(e.stderr);
    }
  },
};
