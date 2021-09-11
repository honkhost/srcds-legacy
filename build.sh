#!/bin/bash

set -exu
cp src/* dist/
docker build -t registry.honkhost.gg/honkhost/srcds/csgo:latest .
docker push registry.honkhost.gg/honkhost/srcds/csgo:latest
