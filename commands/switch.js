const { resolve } = require('path');

module.exports = {
  name: 'kind:switch',
  alias: ['kswitch'],
  run: async ({ print, prompt, kindConfig, getProjectConfig, helm }) => {
    const kubeClient = kindConfig.client;
    const { rootDir, cluster } = kindConfig;
    const { valuesFile: clusterValuesFiles } = cluster;

    const services = await (async () => {
      const { services } = await getProjectConfig();
      return Object.entries(services).filter(([, value]) => 'kind' in value);
    })();

    const { deploy } = await prompt.ask({
      type: 'multiselect',
      name: 'deploy',
      message: `Select services to deploy (${services.length} items. Press '↑' or '↓' to navigate, 'space' to pick, 'enter' to finalize):`,
      limit: 10,
      choices: services.map((s) => s[0]),
      result(names) {
        return services
          .map((s) => s[1])
          .filter(
            (service) =>
              names.includes(service.name) ||
              service.category == 'ingress' ||
              service.category == 'secrets'
          );
      },
    });

    const spinHelmDelete = print.spin('Deleting all running deployments...');

    try {
      await helm.deleteAll('default', kubeClient);
      spinHelmDelete.succeed(`Successfully deleted all running deployments.`);
    } catch (e) {
      spinHelmDelete.succeed(`Failed to delete running deployments.`);
      process.exit(-1);
    }

    deploy.forEach(async ({ path, kind }) => {
      const { values = {}, valuesFile = [] } = kind;
      const templatePath = resolve(rootDir, path);
      const template = await helm.getTemplate(templatePath, {
        values: {
          ...values,
          APP_STAGE: 'development',
          COMMIT: 'HEAD',
        },
        valuesFile: [].concat(clusterValuesFiles, valuesFile),
        rootDir,
      });

      const spinApplyDeployment = print.spin(
        `Applying helm template in ${path}.`
      );
      try {
        const templatesApplied = await helm.applyTemplates(
          templatePath,
          template,
          'default',
          kubeClient
        );

        spinApplyDeployment.succeed(`Successfully applied template in ${path}`);
      } catch (e) {
        spinApplyDeployment.fail(`Failed to apply template in ${path}`);
        print.error(e);
      }
    });
  },
};
