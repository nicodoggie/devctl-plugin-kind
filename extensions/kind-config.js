const findUp = require("find-up");
const { resolve } = require("path");

module.exports = async (toolbox) => {
  const yaml = require("./yaml")(toolbox);
  const { dirname } = require("path");

  const devctlConfig = await findUp(".devctl.yaml");
  const rootDir = (() => devctlConfig && dirname(devctlConfig))();

  const isCluster = rootDir ? true : false;
  const current = await (async () =>
    devctlConfig &&
    (await yaml.readFile(resolve(rootDir, ".devctl-kind.config.yaml"))))();
  const cluster = await (async () =>
    devctlConfig &&
    (await yaml.readFile(resolve(rootDir, ".devctl-kind.yaml"))))();

  const kindConfig = {
    defaults: {
      kind: "Cluster",
      apiVersion: "kind.x-k8s.io/v1alpha4",
      networking: {
        podSubnet: "10.100.0.0/16",
      },
      nodes: [
        {
          role: "control-plane",
          image: "kindest/node:v1.18.2",
          kubeadmConfigPatches: [
            {
              apiVersion: "kubeproxy.config.k8s.io/v1alpha1",
              kind: "KubeProxyConfiguration",
              mode: "ipvs",
              ipvs: {
                strictARP: true,
              },
            },
          ],
          extraPortMappings: [
            {
              containerPort: 80,
              hostPort: 80,
              protocol: "TCP",
            },

            {
              containerPort: 443,
              hostPort: 443,
              protocol: "TCP",
            },
          ],
        },
        {
          role: "worker",
          image: "kindest/node:v1.18.2",
        },
      ],
    },
  };

  toolbox.kindConfig = {
    ...kindConfig,
    rootDir,
    isCluster,
    current: current || {},
    cluster: cluster || {},
  };

  return toolbox.kindConfig;
};
