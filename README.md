devctl-plugin-kind
==================

A plugin for SplitmediaLabs' monorepo developer `devctl` toolkit that deploys 
services into a kubernetes kind developer cluster, instead of using
docker-compose.

Prerequisites
=============

Since the `devctl kind:init` commands haven't been updated yet, you'll have to
install all of the dependencies yourself. This may change the future.

 * **gcloud**: https://cloud.google.com/sdk/docs/downloads-interactive
 * **kubectl**: once gcloud is installed, you can do `gcloud components install kubectl`
 * **kind**: https://kind.sigs.k8s.io/docs/user/quick-start/
 * **helm2**: IMPORTANT! Since at SML we use helm2 exclusively for now, I only
   implemented with helm 2 for now. Will definitely change in the future.
   https://v2.helm.sh/docs/using_helm/#installing-helm

How to use
==========

Install `devctl` if you haven't yet. Some changes in my forked version have yet
to be pulled into the SML one:

```
yarn global add @nicodoggie/devctl
```

Install `@nicodoggie/devctl-plugin-kind` like this:

```
yarn global add devctl-plugin-kind@npm:@nicodoggie/devctl-plugin-kind
```

Currently, the init command is incomplete, and examples aren't up yet. I'll 
rectify that in a future commit.
