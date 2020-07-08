const { KubeConfig, Client } = require("kubernetes-client");
const Request = require("kubernetes-client/backends/request");
const { resolve } = require("path");
const os = require("os");

const kubeconfig = new KubeConfig();
kubeconfig.loadFromFile(resolve(os.homedir(), ".kube", "config"));

module.exports = async function getClient(context, reload = false) {
  // reload config for occasions that we mutate kubeConfig for some reason
  const config = await (async () => {
    if (!reload) {
      return kubeconfig;
    }

    const config = new KubeConfig();
    config.loadFromFile(resolve(os.homedir(), ".kube", "config"));
    return config;
  })();

  config.setCurrentContext(context);

  const client = new Client({
    backend: new Request({
      kubeconfig: config,
    }),
  });
  await client.loadSpec();

  return client;
};
