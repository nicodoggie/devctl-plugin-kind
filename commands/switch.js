const fs = require("fs").promises;
const { dirname } = require("path");
const glob = require("fast-glob");
const yaml = require("js-yaml");
const Promise = require("bluebird");

module.exports = {
  name: "kind:switch",
  alias: ["kswitch"],
  run: async ({ print, kindConfig }) => {
    const kubeClient = kindConfig.client;
    const { rootDir } = kindConfig.cluster;
    const globbedDeploy = await glob(["**/deploy.yaml", "!node_modules"], {
      cwd: rootDir,
    });

    // const repoPV = await kubeClient.api.v1.persistentvolumes("repo-pv").get();
    // console.log(repoPV);

    // We're assuming that everything is deployed to the `default` namespace
    const deployed = await kubeClient.apis.apps.v1
      .namespaces("default")
      .deployments.get();

    const pvObject = {
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
    };

    // console.log(pvObject);

    await kubeClient.api.v1.persistentvolumes.post({ body: pvObject });

    const deployables = (
      await Promise.map(globbedDeploy, async (file) => {
        const contents = await fs.readFile(file);
        const { chart } = yaml.safeLoad(contents);

        if (!chart) {
          return false;
        }

        const { hide = false } = chart;

        return !hide && dirname(file);
      })
    ).filter((i) => i);
  },
};
