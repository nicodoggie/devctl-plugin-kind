module.exports = {
  name: "kind-down",
  alias: ["kdown"],
  run: async ({ print, system, kindConfig }) => {
    const { cluster, rootDir } = kindConfig;
    const { clusterName } = cluster;

    if (!cluster) {
      print.error("devctl-kind is not yet initialized on this cluster.");
      return -1;
    }

    try {
      const execing = print.spin(`Deleting cluster ${clusterName}`);
      await system.run(`kind delete cluster --name ${clusterName}`);
      execing.succeed(`Cluster kind-${clusterName} deleted`);
    } catch (e) {
      print.error(e.stderr);
    }
  },
};
