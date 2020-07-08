const { spawn } = require("child_process");
const retry = require("async-retry");
const { network } = require("../lib/docker");
const getClient = require("../lib/kube");
const kind = require("../lib/kind");

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
        print.info(`Successfully created cluster '${clusterName}'!`);
      } catch (e) {
        print.error(`Failed to create cluster '${clusterName}'.`);
      }
    }

    // Step 5: Run scripts defined in .devctl-kind.yaml
    print.info(`Bootstrapping kind cluster ${clusterName}...`);
    const generatedScripts = scriptRunner(bootstrap, { rootDir });
    let currentType = "";
    for await (const { type, script, output } of generatedScripts) {
      print.info("\n---");
      if (currentType !== type) {
        print.info(` Running ${type} scripts...`);
        currentType = type;
      }

      print.info(`﬑ Ran \`${script}\`\n`);
    }

    const kubeClient = await getClient(`kind-${clusterName}`, true);
    // Step 6: Mount host as /repo and expose /repo as a PVC

    // Check whether the PV exists
    let pvExists = false;
    try {
      print.info("Checking for repository mount PersistentVolume...");

      console.log(
        "repopv",
        await kubeClient.api.v1.persistentvolumes("repo-pv").get()
      );

      print.info(`PersistentVolume 'repo-pv' exists.`);
      pvExists = true;
    } catch (e) {
      print.info(`PersistentVolume 'repo-pv' doesn't exist.`);
    }

    if (!pvExists) {
      // Create PV if it doesn't exist
      const spinCreatePV = print.spin(`Creating PersistentVolume 'repo-pv'...`);

      try {
        await retry(
          async () =>
            await kubeClient.api.v1.persistentvolumes.post({
              body: {
                apiVersion: "v1",
                kind: "PersistentVolume",
                metadata: {
                  name: "repo-pv",
                },
                spec: {
                  accessModes: ["ReadWriteMany"],
                  capacity: {
                    storage: "10Gi",
                  },
                  local: {
                    path: "/repo",
                  },
                  nodeAffinity: {
                    required: {
                      nodeSelectorTerms: [
                        {
                          matchExpressions: [
                            {
                              key: "web",
                              operator: "In",
                              values: ["1"],
                            },
                          ],
                        },
                      ],
                    },
                  },
                  storageClassName: "standard",
                },
              },
            }),
          {
            retries: 5,
          }
        );
        spinCreatePV.succeed(
          `Successfully created PersistentVolume 'repo-pv'.`
        );
      } catch (e) {
        spinCreatePV.fail(`Failed to create PersistentVolume 'repo-pv'.`);
        print.error(e);
        process.exit(-3);
      }
    }

    // // Check whether the PVC exists in the default namespace
    let pvcExists = false;
    try {
      print.info("Checking for repository mount PersistentVolumeClaim...");

      await retry(
        async () =>
          await kubeClient.api.v1
            .namespaces("default")
            .persistentvolumeclaims("repo-pvc")
            .get(),
        {
          retries: 5,
          minTimeout: 2000,
          maxTimeout: 15000,
        }
      );

      pvcExists = true;
      print.info(
        `PersistentVolumeClaim 'repo-pvc' exists in namespace 'default'.`
      );
    } catch (e) {
      print.info(
        `PersistentVolumeClaim 'repo-pvc' doesn't exist in namespace 'default'.`
      );
    }

    if (!pvcExists) {
      const spinCreatePVC = print.spin(
        `Creating PersistentVolume 'repo-pv'...`
      );

      try {
        await kubeClient.api.v1
          .namespaces("default")
          .persistentvolumeclaims.post({
            body: {
              apiVersion: "v1",
              kind: "PersistentVolumeClaim",
              metadata: {
                name: "repo-pvc",
              },
              spec: {
                accessModes: ["ReadWriteMany"],
                resources: {
                  requests: {
                    storage: "10Gi",
                  },
                },
                volumeName: "repo-pv",
              },
            },
          });
        spinCreatePVC.succeed(
          `Successfully created PersistentVolumeClaim 'repo-pvc'`
        );
      } catch (e) {
        spinCreatePVC.fail(
          `Failed to create PersistentVolumeClaim 'repo-pvc'.`
        );
        print.error(e);
        process.exit(-3);
      }
    }

    print.info(`Successfully bootstrapped the ${clusterName} cluster!`);
  },
};
