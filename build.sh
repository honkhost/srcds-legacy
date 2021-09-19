#!/bin/bash

set -exu
cp src/* dist/
docker build -t registry.honkhost.gg/honkhost/csgo:latest-dev .
docker push registry.honkhost.gg/honkhost/csgo:latest-dev
