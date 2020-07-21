module.exports = async (toolbox) => {
  const findUp = require('find-up');
  const { resolve } = require('path');
  const getClient = require('../lib/kube');

  const { getProjectConfig } = toolbox;

  const list = () => {
    // List all kind services
    const services = await(async () => {
      const { services } = await getProjectConfig();
      return Object.entries(services).filter(([, value]) => 'kind' in value);
    })();
  };
  const getConfig = () => {};
};
