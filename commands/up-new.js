const { network } = require("../lib/docker");
const kind = require("../lib/kind");
const { spawn } = require("child_process");
const scriptRunner = require("../lib/script-runner");

module.exports = {
  name: "kind:up",
  alias: ["kup"],
  run: async function ({ print, system, kindConfig, parameters }) {
    if (!kindConfig.isCluster) {
      throw new Error(`Please intialize the cluster first.`);
    }

    const { replace } = parameters.options;

    const {
      clusterName,
      rootDir,
      network: { subnet },
      bootstrap,
    } = kindConfig.cluster;
    const networkName = `kind-net-${clusterName}`;
    // Step 1: Check for a running network and cluster with the same name
    // Step 1a: If running, delete them

    const clusterExists = await kind.exists(clusterName);
    if (clusterExists) {
      print.info(`Cluster ${clusterName} exists.`);
    }

    if (clusterExists && replace) {
      print.warning(`Option --replace is set, cluster will be re-initialized.`);
      const spinClusterDelete = print.spin(
        `Deleting kind cluster ${clusterName}...`
      );
      spinClusterDelete.succeed(
        `Successfully deleted kind cluster ${clusterName}.`
      );
      try {
        await kind.delete(clusterName);
      } catch (e) {
        spinClusterDelete.fail(`Cannot delete kind cluster ${clusterName}.`);
      }
    }

    const existingNetwork = await network.find(networkName);
    if (existingNetwork) {
      print.info(`Network '${networkName}' exists.`);
    }

    if (existingNetwork !== null && replace) {
      print.warning(`Option --replace is set, network will be re-initialized.`);
      const spinNetDelete = print.spin(`Deleting...`);
      try {
        await network.delete(existingNetwork);
        spinNetDelete.succeed(`Successfully deleted network '${networkName}'.`);
      } catch (e) {
        spinNetDelete.fail(`Failed to delete ${networkName}.`);
        print.error(e);
        process.exit(-1);
      }
    }

    // Step 2: If not configured, search for a node network that doesn't
    // conflict with any routes
    // Step 3: Create a docker network named `kind-net-<cluster-name>` for the nodes
    if (existingNetwork === null || replace) {
      const spinNetCreate = print.spin(
        `Creating network '${networkName}' with subnet ${subnet}.`
      );
      try {
        await network.create(networkName, subnet);
        spinNetCreate.succeed(
          `Successfully created network ${networkName} with subnet ${subnet}`
        );
      } catch {
        spinNetCreate.fail(
          `Failed to create network ${networkName} with subnet ${subnet}`
        );
        process.exit(-2);
      }
    }
    // Step 4: Create the kind cluster based on .devctl-kind.config.conf
    const createCluster = () =>
      new Promise((resolve, reject) => {
        const spawned = spawn(
          "kind",
          [
            "create",
            "cluster",
            "--name",
            clusterName,
            "--config",
            ".devctl-kind.config.yaml",
          ],
          {
            cwd: rootDir,
            env: {
              ...process.env,
              KIND_EXPERIMENTAL_DOCKER_NETWORK: networkName,
            },
          }
        );

        spawned.stdout.on("data", (data) => {
          print.info(data.toString());
        });

        spawned.stderr.on("data", (data) => {
          print.error(data.toString());
        });

        spawned.on("close", (code) => {
          if (code == 0) {
            resolve();
          } else {
            console.log(`kind exited with code ${code}`);
            reject();
          }
        });
      });

    if (!clusterExists || replace) {
      try {
        print.info(`Creating kind cluster ${clusterName}...`);
        await createCluster();
        print.info(`Successfully created cluster '${clusterName}!'`);
      } catch (e) {
        print.error(`Failed to create cluster '${clusterName}'.`);
      }
    }

    // Step 5: Run scripts defined in .devctl-kind.yaml
    print.info(`Bootstrapping kind cluster ${clusterName}...`);
    const generatedScripts = scriptRunner(bootstrap, { rootDir });
    let currentType = "";
    for await (const { type, script, output } of generatedScripts) {
      if (currentType !== type) {
        print.info(`Running ${type} scripts...`);
        currentType = type;
      }

      print.info(`Ran \`${script}\``);
    }

    print.info(`Successfully bootstrapped the ${clusterName} cluster!`);
  },
};
