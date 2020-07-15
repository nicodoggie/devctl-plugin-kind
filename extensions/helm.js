const { template } = require("lodash");

module.exports = async (toolbox) => {
  const { spawn } = require("child_process");
  const { resolve } = require("path");
  const fs = require("fs").promises;

  const randomstring = require("randomstring");
  const Promise = require("bluebird");
  const groupBy = require("lodash/groupBy");
  const merge = require("lodash/merge");
  const get = require("lodash/get");
  const jsYaml = require("js-yaml");

  const asyncSpawn = async (command, args, opts) =>
    new Promise((resolve, reject) => {
      const proc = spawn(command, args, opts);

      let stdout = Buffer.alloc(0);
      proc.stdout.on("data", (data) => {
        stdout = Buffer.concat([stdout, data]);
      });

      let stderr = Buffer.alloc(0);
      proc.stderr.on("data", (data) => {
        stderr = Buffer.concat([stderr, data]);
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(stderr);
        }
        resolve(stdout);
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });

  async function deleteAll(namespace, client) {
    const deployments = await client.apis.apps.v1
      .namespaces(namespace)
      .deployments.get();
    const configmaps = await client.api.v1
      .namespaces(namespace)
      .configmaps.get();
    const services = await client.api.v1.namespaces(namespace).services.get();
    const ingresses = await client.apis.extensions.v1beta1
      .namespace(namespace)
      .ingresses.get();
    const secrets = await client.api.v1.namespace(namespace).secrets.get();

    const promises = [];
    promises.push(
      ...deployments.body.items.map((dp) => {
        const name = dp.metadata.name;
        return client.apis.apps.v1
          .namespaces(namespace)
          .deployment(name)
          .delete();
      })
    );
    promises.push(
      ...configmaps.body.items.map((cm) => {
        const name = cm.metadata.name;
        return client.api.v1.namespaces(namespace).configmap(name).delete();
      })
    );
    promises.push(
      ...services.body.items.map((svc) => {
        const name = svc.metadata.name;
        return client.api.v1.namespaces(namespace).service(name).delete();
      })
    );
    promises.push(
      ...ingresses.body.items.map((ing) => {
        const name = ing.metadata.name;
        return client.apis.extensions.v1beta1
          .namespace(namespace)
          .ingress(name)
          .delete();
      })
    );
    promises.push(
      ...secrets.body.items.map((secret) => {
        const name = secret.metadata.name;
        return client.api.v1.namespaces(namespace).secrets(name).delete();
      })
    );

    return Promise.allSettled(promises);
  }

  async function getTemplate(chartPath, opts) {
    const { values = {}, valuesFile = [], rootDir = process.cwd() } = opts;

    const args = ["template", chartPath];

    if (valuesFile.length > 0) {
      valuesFile.forEach((file) => {
        args.push("-f", resolve(rootDir, file));
      });
    }

    const tmpDir = await fs.mkdtemp("devctl-kind");
    const tmpFile = resolve(
      tmpDir,
      `${randomstring.generate({ length: 6, charset: "alphabetic" })}.yaml`
    );

    if (values != {}) {
      await toolbox.yaml.writeFile(tmpFile, values);
      args.push("-f", tmpFile);
    }

    const raw = await asyncSpawn("helm", args, { cwd: rootDir });

    // cleanup
    await toolbox.filesystem.removeAsync(tmpDir);

    return jsYaml.safeLoadAll(raw);
  }

  async function applyDevconfigDeploymentOverrides(template, deployConfig) {
    if (template.kind !== "Deployment") {
      throw new Error(`Template passed is not a Deployment`);
    }

    // If devconfig doesn't have a kind spec, or a deployment section,
    // return a template

    const { spec: podSpec } = template.spec.template;

    // Add repo-pvc to the volumes
    const volumes = get(podSpec, "volumes", []);
    volumes.push({
      name: "repo-pvc",
      persistentVolumeClaim: {
        claimName: "repo-pvc",
      },
    });

    const hostAliases = [];
    // find ContainerSpec that matches deployConfig
    const containers = podSpec.containers.map((container) => {
      if (!(container.name in deployConfig)) {
        return container;
      }

      const containerConfig = deployConfig[container.name];

      // Readiness and Liveness probes should not exist in dev
      if ("readinessProbe" in container) {
        delete container.readinessProbe;
      }

      if ("livenessProbe" in container) {
        delete container.readinessProbe;
      }

      const volumeMounts = get(container, "volumeMounts", []);
      const volumes = get(containerConfig, "volumes", [])
        .map((volume) => {
          const isValid = volume.match(
            /[0-9a-z\/\._-]+:[0-9a-z\/\._-]+(:[0-9a-z\/\._-]+)?/
          );
          if (!isValid) {
            return false;
          }

          const parts = volume.split(":");
          // if volume name is not defined, default to repo-pvc (repo mount)
          const name = (() => {
            if (parts.length === 3) {
              return parts.shift();
            }
            return "repo-pvc";
          })();
          const [subPath, mountPath] = parts;

          return {
            subPath,
            mountPath,
            name,
          };
        })
        .filter((i) => i);

      const repoMountPath = get(containerConfig, "repoMountPath");
      if (repoMountPath) {
        volumeMounts.push({
          mountPath: repoMountPath,
          name: "repo-pvc",
        });
      }

      if ("hostAliases" in containerConfig) {
        hostAliases.push(...containerConfig.hostAliases);
        delete containerConfig.hostAliases;
      }

      return {
        ...container,
        ...containerConfig,
        volumeMounts: volumeMounts.concat(volumes),
      };
    });

    template.spec.template.spec.containers = containers;
    template.spec.template.spec.volumes = volumes;
    template.spec.template.spec.hostAliases = hostAliases;

    return template;
  }

  async function applyTemplates(
    path,
    templates,
    namespace = "default",
    client
  ) {
    return Promise.all(
      templates
        .map(async (template) => {
          if (!template) {
            return false;
          }
          const configFilePath = resolve(path, ".devconfig.yaml");
          const config = await toolbox.yaml.readFile(configFilePath);

          const { kind: { deployment: deploymentConfig = {} } = {} } = config;

          switch (template.kind) {
            case "Deployment":
              // replace values here
              const deployTemplate = await applyDevconfigDeploymentOverrides(
                template,
                deploymentConfig
              );
              return client.apis.apps.v1
                .namespaces(namespace)
                .deployments.post({ body: deployTemplate });
            case "ConfigMap":
              return client.api.v1
                .namespaces(namespace)
                .configmaps.post({ body: template });
            case "Service":
              return client.api.v1
                .namespaces(namespace)
                .services.post({ body: template });
            case "Secret":
              ``;
              return client.api.v1
                .namespaces(namespace)
                .secrets.post({ body: template });
            case "Ingress":
              return client.apis.extensions.v1beta1
                .namespaces(namespace)
                .ingresses.post({ body: template });
          }
        })
        .filter((i) => i)
    );
  }

  toolbox.helm = {
    deleteAll,
    getTemplate,
    applyTemplates,
  };
};
