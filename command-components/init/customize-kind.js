const dockerHub = require("@keymetrics/docker-hub-api");
const get = require("lodash/get");
const merge = require("lodash/merge");

function addControlPlaneNode(version, { taints }) {
  const node = {
    role: "control-plane",
    image: `kindest/node:${version}`,
    extraPortMappings: [
      { containerPort: 80, hostPort: 80, protocol: "TCP" },
      { containerPort: 443, hostPort: 443, protocol: "TCP" },
    ],
  };

  if (taints) {
    const taintConfig = {
      kind: "InitConfiguration",
      nodeRegistration: {
        kubeletExtraArgs: {
          "node-labels": taints,
        },
      },
    };

    node.kubeadmConfigPatches.push(taintConfig);
  }

  return node;
}

function addWorkerNode(version, { taints }) {
  const node = {
    role: "worker",
    image: `kindest/node:${version}`,
  };

  if (taints) {
    const taintConfig = {
      kind: "JoinConfiguration",
      nodeRegistration: {
        kubeletExtraArgs: {
          "node-labels": taints,
        },
      },
    };

    node.kubeadmConfigPatches = [taintConfig];
  }

  return node;
}

module.exports = async function customizeKind({ prompt, kindConfig, yaml }) {
  const { defaults } = kindConfig;

  const { willCustomize } = await prompt.ask({
    type: "confirm",
    name: "willCustomize",
    message: "Do you want to customize the cluster?",
  });

  if (!willCustomize) {
    return defaults;
  }

  // step 2c: choose kubernetes version
  const nodeVersions = await dockerHub.tags("kindest", "node", {
    perPage: 5,
  });

  // step 2d: number of control-plane nodes
  // step 2e: number of worker nodes
  const {
    kubeVersion,
    numControlPlanes,
    numWorkers,
    podSubnet,
  } = await prompt.ask([
    {
      type: "select",
      name: "kubeVersion",
      choices: nodeVersions.map(({ name }) => name),
    },
    {
      type: "numeral",
      name: "numControlPlanes",
      message: "How many control plane nodes?",
      initial: 1,
    },
    {
      type: "numeral",
      name: "numWorkers",
      message: "How many worker nodes?",
      initial: 2,
    },
    {
      type: "input",
      name: "podSubnet",
      message: "Pod IP Subnet range:",
      initial: "10.100.0.0/16",
    },
  ]);

  const controlPlaneNodes = [];
  for (let idx = 0; idx < numControlPlanes; ++idx) {
    const { taints } = await prompt.ask({
      type: "input",
      name: "taints",
      message: `Define taints for control-plane node #${
        idx + 1
      } (delimit by commas, leave empty for none)`,
      initial: "",
    });

    const node = addControlPlaneNode(kubeVersion, { taints });

    const kubeadmConfigPatches = get(node, "kubeadmConfigPatches", []);

    controlPlaneNodes.push({
      ...node,
      kubeadmConfigPatches,
    });
  }

  const workerNodes = [];
  for (let idx = 0; idx < numWorkers; ++idx) {
    const { taints } = await prompt.ask({
      type: "input",
      name: "taints",
      message: `Define taints for worker node #${
        idx + 1
      } (delimit by commas, leave empty for none)`,
      initial: "",
    });

    workerNodes.push(addWorkerNode(kubeVersion, { taints }));
  }

  return {
    kind: "Cluster",
    apiVersion: "kind.x-k8s.io/v1alpha4",
    networking: {
      podSubnet,
    },
    nodes: [...controlPlaneNodes, ...workerNodes],
  };
};
