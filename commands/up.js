const { resolve } = require("path");
const { exec } = require("child_process");

module.exports = {
  name: "kind-up",
  alias: ["kup"],
  run: async ({ print, system, kindConfig }) => {
    const { cluster, rootDir } = kindConfig;
    const { clusterName, bootstrap = [] } = cluster;

    if (!cluster) {
      print.error("devctl-kind is not yet initialized on this cluster.");
      return -1;
    }

    const execing = print.spin(`Creating cluster ${clusterName}`);
    try {
      console.log(
        await system.run(
          `kind create cluster --name ${clusterName} --config ${resolve(
            rootDir,
            ".devctl-kind.config.yaml"
          )}`
        )
      );
      execing.succeed(`Cluster kind-${clusterName} created!`);
    } catch (e) {
      console.error(e);
      execing.fail(`Failed creating cluster kind-${clusterName}`);
    }

    // Run bootstrap scripts
    for (const { type, scripts } of bootstrap) {
      let failed = false;

      const strapping = print.spin(`Bootstrapping ${type}...`);
      for (const script of scripts) {
        const running = print.spin(`Running script \`${script}\`...`);
        try {
          await system.run(script, { cwd: rootDir });
          running.succeed(`Script \`${script}\` successfully ran!`);
        } catch (e) {
          running.fail(`Script \`${script}\` failed!`);
          console.error(e);
          failed = true;
          break;
        }
      }

      if (failed) {
        strapping.fail(`Failed running bootstrap script for ${type}.\n`);
        break;
      }

      strapping.succeed(`Bootstrapped ${type} successfully!`);
    }
  },
};
