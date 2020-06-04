const os = require("os");
const fs = require("fs");
const get = require("lodash/get");
const merge = require("lodash/merge");
const findUp = require("find-up");
const axios = require("axios");
const dockerHub = require("@keymetrics/docker-hub-api");
const Promise = require("bluebird");
const { resolve, basename, dirname } = require("path");
const { once } = require("events");
const { promisify } = require("util");
const { finished } = require("stream");
const { get: httpGet } = require("axios");

dockerHub.setCacheOptions({ enabled: true, time: 60 });

function getOS() {
  const arch = os.arch() == "x64" ? "amd64" : os.arch();
  switch (os.type()) {
    case "Windows_NT":
      return `windows-${arch}`;
    case "Darwin":
      return `darwin-${arch}`;
    default:
    case "Linux":
      return `linux-${arch}`;
  }
}

async function download(url, destination) {
  try {
    const options = {
      url,
      method: "get",
      responseType: "stream",
    };

    const response = await axios(options);
    const writeFile = fs.createWriteStream(destination);
    for await (const chunk of response.data) {
      if (!writeFile.write(chunk)) {
        await once(writeFile, "drain");
      }
    }

    writeFile.end();
    await promisify(finished)(writeFile);
  } catch (e) {
    throw e;
  }
}

function addNode(role, version, { taints }) {
  const node = {
    role,
    image: `kindest/node:${version}`,
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

    node.kubeadmConfigPatches = [taintConfig];
  }

  return node;
}

async function installKind({ filesystem, print, prompt, system: { run } }) {
  const path = await run("npm -g bin", { trim: true });
  const globalBin = path;
  const toolsDir = resolve(__dirname, "..", "tools");
  const kindPath = resolve(toolsDir, "kind");

  if (await filesystem.existsAsync(resolve(globalBin, "kind"))) {
    print.info("kind is already installed.");
    return;
  }

  // retrieves releases from kind
  const releases = await httpGet(
    "https://api.github.com/repos/kubernetes-sigs/kind/releases"
  );

  const versions = releases.data.map(({ tag_name, assets }) => ({
    name: tag_name,
    message: tag_name,
    value: [tag_name, assets],
  }));

  const {
    version: [version, assets],
  } = await prompt.ask({
    type: "select",
    name: "version",
    message: "Choose the version of kind to install: ",
    choices: versions,
    result() {
      return this.focused.value;
    },
  });

  const [
    { name: assetName, browser_download_url: downloadUrl },
  ] = assets.filter(({ name }) => name === `kind-${getOS()}`);

  await filesystem.dirAsync(toolsDir);

  const downloading = print.spin(
    `Downloading kind version ${version} ${assetName}...`
  );

  try {
    await download(downloadUrl, kindPath);
    downloading.succeed("Successfully downloaded kind.");
    filesystem.chmodSync(
      kindPath,
      fs.constants.S_IWUSR | fs.constants.S_IRUSR | fs.constants.S_IXUSR
    );
  } catch (e) {
    downloading.fail("Downloading kind failed.");
    console.error(e);
  }

  // Link kind into npm global bin, which is likely in PATH
  const linking = print.spin(
    `Creating symlink: ${kindPath} -> ${globalBin}...`
  );
  try {
    await run(`ln -s ${kindPath} ${globalBin}`);
    linking.succeed("Successfully created a symlink.");
  } catch (e) {
    linking.fail("Failed to create a symlink.");
    console.error(e);
  }
}

async function customizeKind({ prompt }) {
  // step 2c: choose kubernetes version
  const nodeVersions = await dockerHub.tags("kindest", "node", { perPage: 5 });

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
      initial: "10.100.0.0/24",
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

    controlPlaneNodes.push(addNode("control-plane", kubeVersion, { taints }));
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

    workerNodes.push(addNode("worker", kubeVersion, { taints }));
  }

  return {
    networking: { podSubnet },
    nodes: [...controlPlaneNodes, ...workerNodes],
  };
}

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
async function customizeIngress() {}
async function customizeLoadBalancer() {}

module.exports = {
  name: "kind-init",
  alias: ["kinit"],
  run: async (toolbox) => {
    const { print, prompt, kindConfig, filesystem, yaml } = toolbox;
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
    const { clusterName, willCustomize } = await prompt.ask([
      {
        type: "input",
        name: "clusterName",
        message: `Cluster name:`,
        initial: defaultClusterName,
      },
      {
        type: "confirm",
        name: "willCustomize",
        message: "Do you want to customize the cluster?",
      },
    ]);

    const { defaults } = kindConfig;

    // step 2b: confirm cluster customization
    const mergedConfig = merge(
      willCustomize ? await customizeKind(toolbox) : {},
      defaults
    );
    // step 2h: stringify kubeadmConfigPatches
    const nodes = mergedConfig.nodes.map((node) => {
      const patches = get(node, "kubeadmConfigPatches");

      if (patches) {
        const kubeadmPatches = patches.map((patch) => yaml.safeDump(patch));
        node.kubeadmConfigPatches = kubeadmPatches;
      }

      return node;
    });
    // step 2h: write to .devctl-kind.config.yaml
    await yaml.writeFile(resolve(rootDir, ".devctl-kind.config.yaml"), {
      ...mergedConfig,
      nodes,
    });

    // step 3d: write to .devctl-kind.yaml
    await yaml.writeFile(resolve(rootDir, ".devctl-kind.yaml"), {
      clusterName,
    });

    // step 3a: choose to install helm 2, helm 3 or none
    // step 3b: choose to install ingress, default to nginx
    // step 3c: if ingress is installed, choose to install metallb
  },
};
