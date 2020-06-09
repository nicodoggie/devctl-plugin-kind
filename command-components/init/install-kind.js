const os = require("os");
const fs = require("fs");
const axios = require("axios");
const { resolve } = require("path");
const { once } = require("events");
const { promisify } = require("util");
const { finished } = require("stream");
const { get: httpGet } = require("axios");

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

module.exports = async function installKind({
  filesystem,
  print,
  prompt,
  system: { run },
}) {
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
};
