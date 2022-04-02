#!/bin/bash

set -exu

docker build -t registry.honkhost.dev/gameservers/csgo:latest-dev .
docker push registry.honkhost.dev/gameservers/csgo:latest-dev
