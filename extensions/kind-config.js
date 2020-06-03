module.exports = (toolbox) => {
  toolbox.kindConfig = {
    defaults: {
      networking: {
        podSubnet: "10.100.0.0/24",
      },
      nodes: [
        {
          role: "control-plane",
          image: "kindest/node:v1.18.2",
          kubeadmConfigPatches: [
            {
              apiVersion: "kubeproxy.config.k8s.io/v1alpha1",
              kind: "InitConfiguration",
              mode: "ipvs",
              ipvs: {
                strictARP: true,
              },
            },
          ],
          extraPortMappings: [
            {
              containerPort: 80,
              hostPort: 89,
              protocol: "TCP",
            },

            {
              containerPort: 443,
              hostPort: 443,
              protocol: "TCP",
            },
          ],
        },
        {
          role: "worker",
          image: "kindest/node:v1.18.2",
        },
      ],
    },
  };
};
