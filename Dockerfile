# syntax=docker/dockerfile:1

FROM registry.honkhost.gg/honkhost/srcds/steamcmd:latest-dev
LABEL maintainer="epers@honkhost.gg"

USER root

ENV NODE_ENV=production
COPY ./dist /dist
COPY ./package.json /dist/package.json
COPY ./package-lock.json /dist/package-lock.json

RUN set -x \
    && cd /dist \
    && npm install --production

USER container
ENV USER=container \
    HOME="/home/container" \
    HOMEDIR="/home/container" \
    STEAMCMDDIR="/home/container/steamcmd" \
    SRCDS_BASEDIR="/home/container/srcds" \
    SRCDS_APPID="740" \
    SRCDS_GAME="csgo" \
    SRCDS_HOSTNAME="csgo-server" \
    SRCDS_PORT="27115" \
    SRCDS_IP="0.0.0.0" \
    SRCDS_CLIENTPORT="27005" \
    SRCDS_HLTVPORT="27120" \
    SRCDS_TICKRATE="64" \
    SRCDS_STARTUPMAP="de_nuke" \
    SRCDS_SERVERCFGFILE="server.cfg" \
    SRCDS_MAXPLAYERS="12" \
    SRCDS_GAMETYPE="1" \
    SRCDS_GAMEMODE="2" \
    SRCDS_GSLT="" \
    SRCDS_WSAPIKEY="" \
    REDIS_PASSWORD="" \
    REDIS_HOST="" \
    NODE_ENV=production

WORKDIR /dist
ENTRYPOINT ["node", "main.mjs"]
