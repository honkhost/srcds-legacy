#!/bin/bash

set -exu
docker build -t registry.honkhost.gg/honkhost/csgo:latest-dev .
docker push registry.honkhost.gg/honkhost/csgo:latest-dev
