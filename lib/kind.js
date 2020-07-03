const { promisify } = require("util");
const { exec, spawn } = require("child_process");
const promisedExec = promisify(exec);

const getClusters = async () => {
  const { stdout } = await promisedExec("kind get clusters");

  return stdout.trim().split("\n");
};
module.exports = {
  create() {},
  async delete(name) {
    await promisedExec(`kind delete cluster --name ${name}`);
  },
  async exists(name) {
    const clusters = await getClusters();

    return clusters.includes(name);
  },
};
