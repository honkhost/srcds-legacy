#!/bin/bash

set -exu

# echo "Switching upstream tag for steamcmd to latest-dev for dev build"
# sed -i 's/registry.honkhost.gg\/honkhost\/steamcmd:latest/registry.honkhost.gg\/honkhost\/steamcmd:latest-dev/g' Dockerfile

docker build -t registry.honkhost.gg/honkhost/srcds/csgo:latest-dev .
docker push registry.honkhost.gg/honkhost/srcds/csgo:latest-dev

# echo "Switching upstream tag for steamcmd back to latest for autobuild"
# sed -i 's/registry.honkhost.gg\/honkhost\/steamcmd:latest-dev/registry.honkhost.gg\/honkhost\/steamcmd:latest/g' Dockerfile
