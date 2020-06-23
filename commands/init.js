const get = require("lodash/get");
const merge = require("lodash/merge");
const findUp = require("find-up");
const dockerHub = require("@keymetrics/docker-hub-api");
const { resolve, basename, dirname } = require("path");

const installKind = require("../command-components/init/install-kind");
const customizeKind = require("../command-components/init/customize-kind");

dockerHub.setCacheOptions({ enabled: true, time: 60 });

async function installHelm({ prompt }) {
  const { whichHelm } = await prompt.ask([
    {
      type: "select",
      name: "whichHelm",
      message: "Which helm version?",
      choices: ["Helm v2", "Helm v3"],
    },
  ]);

  whichHelm;
}

async function customizeLoadBalancer() {
  return {
    type: "load-balancer",
    scripts: [],
  };
}

async function customizeIngress() {
  return {
    type: "ingress",
    scripts: [],
  };
}

module.exports = {
  name: "kind:init",
  alias: ["kinit"],
  run: async (toolbox) => {
    const { print, prompt, yaml } = toolbox;
    const devctlConfig = await findUp(".devctl.yaml", { type: "file" });

    if (!devctlConfig) {
      print.error("Run `devctl init` to initialize devctl.");
      return -1;
    }

    const rootDir = dirname(devctlConfig);

    // step 1: install kind, choose version
    await installKind(toolbox);

    const defaultClusterName = basename(process.cwd()).toLowerCase();
    // step 2a: confirm cluster name
    const { clusterName } = await prompt.ask([
      {
        type: "input",
        name: "clusterName",
        message: `Cluster name:`,
        initial: defaultClusterName,
      },
    ]);

    // step 2b: confirm cluster customization
    const customKindConfig = await customizeKind(toolbox);

    // step 2h: stringify kubeadmConfigPatches
    const nodes = customKindConfig.nodes.map((node) => {
      const patches = get(node, "kubeadmConfigPatches");

      if (patches) {
        const kubeadmPatches = patches.map((patch) => yaml.safeDump(patch));
        node.kubeadmConfigPatches = kubeadmPatches;
      }

      return node;
    });
    // step 2h: write to .devctl-kind.config.yaml
    await yaml.writeFile(resolve(rootDir, ".devctl-kind.config.yaml"), {
      ...customKindConfig,
      nodes,
    });

    const bootstrap = [];

    // bootstrap.push(await customizeLoadBalancer());
    // bootstrap.push(await customizeIngress());

    // step 3d: write to .devctl-kind.yaml
    await yaml.writeFile(resolve(rootDir, ".devctl-kind.yaml"), {
      clusterName,
      bootstrap,
    });

    // step 3a: choose to install helm 2, helm 3 or none
    // step 3b: choose to install ingress, default to nginx
    // step 3c: if ingress is installed, choose to install metallb
  },
};
