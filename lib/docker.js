const { Docker } = require("node-docker-api");
const { promisify } = require("util");
const { find } = require("lodash");
const IPCIDR = require("ip-cidr");
const spawn = promisify(require("child_process").spawn);

const docker = new Docker();

const network = {
  async create(name, subnet) {
    const cidrSubnet = new IPCIDR(subnet);

    if (!cidrSubnet.isValid()) {
      throw new Error(`Subnet ${subnet} is not a valid subnet.`);
    }
    // console.log(cidrSubnet);

    // the library lits the network IP as first
    // so we pick the next one, then return as string
    const firstAddress = cidrSubnet.start().replace(/0$/, "1");
    const networkOpts = {
      Name: name,
      Driver: "bridge",
      IPAM: {
        Config: [
          {
            Subnet: cidrSubnet.toString(),
            Range: cidrSubnet.toString(),
            Gateway: firstAddress,
          },
        ],
      },
      Labels: {
        "com.splitmedialabs.devctl-kind-network": name,
      },
    };

    return docker.network.create(networkOpts);
  },
  async exists(name) {
    const network = await this.find(name);
    return network ? true : false;
  },
  async delete(network) {
    return await network.remove();
  },
  async find(name) {
    const filters = JSON.stringify({ name: { [name]: true } });
    const existingNetwork = await docker.network.list({ filters });
    return existingNetwork.length > 0 ? existingNetwork[0] : null;
  },
};

module.exports = {
  docker: docker,
  network,
};
