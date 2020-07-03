const os = require("os");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);

module.exports = async function* (bootstrap, { rootDir }) {
  const platform = os.platform();

  for (const { type, scripts } of bootstrap) {
    for (const script of scripts) {
      const typeOf = typeof script;

      if (typeOf === "string") {
        // If string, run with shell as its default shell
        const { stdout, stderr } = await exec(script, {
          cwd: rootDir,
          shell: true,
          windowsHide: true,
        });

        yield { type, script, output: stdout };
      } else if (typeOf == "object") {
        // IF object run command based on platform, default to linux or 'default' if platform
        // undefined in scripts
      }
    }
  }
};
