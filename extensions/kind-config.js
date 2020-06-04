const findUp = require("find-up");

module.exports = async (toolbox) => {
  const yaml = require("./yaml")(toolbox);
  const { dirname } = require("path");

  const devctlConfig = await findUp(".devctl.yaml");
  const rootDir = (() => devctlConfig && dirname(devctlConfig))();
  const current = await (async () =>
    devctlConfig && (await yaml.readFile(".devctl-kind.config.yaml")))();
  const cluster = await (async () =>
    devctlConfig && (await yaml.readFile(".devctl-kind.yaml")))();

  const kindConfig = {
    defaults: {
      kind: "Cluster",
      apiVersion: "kind.x-k8s.io/v1alpha4",
      networking: {
        podSubnet: "10.100.0.0/24",
      },
      nodes: [
        {
          role: "control-plane",
          image: "kindest/node:v1.18.2",
          kubeadmConfigPatches: [
            {
              apiVersion: "kubeproxy.config.k8s.io/v1alpha1",
              kind: "InitConfiguration",
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
    current: current || {},
    cluster: cluster || {},
  };

  return toolbox.kindConfig;
};
