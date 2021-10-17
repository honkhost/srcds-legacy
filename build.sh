#!/bin/bash

set -exu

echo "Switching upstream tag for csgo to latest-dev for dev build"
sed -i 's/registry.honkhost.gg\/honkhost\/csgo:latest/registry.honkhost.gg\/honkhost\/csgo:latest-dev/g' Dockerfile

docker build -t registry.honkhost.gg/honkhost/csgo:latest-dev .
docker push registry.honkhost.gg/honkhost/csgo:latest-dev

echo "Switching upstream tag for csgo back to latest for autobuild"
sed -i 's/registry.honkhost.gg\/honkhost\/csgo:latest-dev/registry.honkhost.gg\/honkhost\/csgo:latest/g' Dockerfile
