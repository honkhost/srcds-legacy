# syntax=docker/dockerfile:1

FROM registry.honkhost.gg/honkhost/steamcmd:latest
LABEL maintainer="epers@honkhost.gg"

USER root

ENV NODE_ENV=production
COPY ./src /dist
COPY ./package.json /dist/package.json
COPY ./package-lock.json /dist/package-lock.json

RUN set -exu \
  && cd /dist \
  && npm install --production

USER container
ENV USER=container \
  HOME="/home/container" \
  HOMEDIR="/home/container" \
  SRCDS_STEAMCMDDIR="/opt/steamcmd" \
  SRCDS_SERVERFILESDIR="/opt/serverfiles" \
  SRCDS_HOSTNAME="csgo-server" \
  SRCDS_GAME="csgo" \
  SRCDS_PORT="27215" \
  SRCDS_TICKRATE="64" \
  SRCDS_STARTUPMAP="de_nuke" \
  SRCDS_SERVERCFGFILE="server.cfg" \
  SRCDS_MAXPLAYERS="12" \
  SRCDS_GAMETYPE="1" \
  SRCDS_GAMEMODE="2" \
  SRCDS_GSLT="" \
  SRCDS_WSAPIKEY="" \
  SRCDS_TRUSTUPDDATE="false" \
  REDIS_PASSWORD="" \
  REDIS_HOST="" \
  NODE_ENV=production

WORKDIR /dist
ENTRYPOINT ["node", "main.mjs"]
