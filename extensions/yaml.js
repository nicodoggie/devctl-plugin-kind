module.exports = (toolbox) => {
  const yaml = require("js-yaml");
  const { filesystem } = toolbox;
  toolbox.yaml = {
    ...yaml,
    readFile: async (filename) => {
      const contents = await filesystem.readAsync(filename, "buffer");
      return yaml.safeLoad(contents);
    },
    writeFile: async (filename, contents, yamlOptions = {}) => {
      const dump = yaml.safeDump(contents, yamlOptions);

      await filesystem.writeAsync(filename, dump, { atomic: true });
    },
  };
  return toolbox.yaml;
};
