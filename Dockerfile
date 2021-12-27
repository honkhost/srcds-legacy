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
  NODE_ENV=production \
  DEBUG="true" \
  SRCDS_AUTOUPDATE="true" \
  SRCDS_HTTP_PROXY="" \
  SRCDS_FORCE_VALIDATE="" \
  SRCDS_WS_STATIC_TOKEN="" \
  SRCDS_PORT="27015" \
  SRCDS_TICKRATE="64" \
  SRCDS_MAXPLAYERS="20" \
  SRCDS_STARTUPMAP="de_nuke" \
  SRCDS_SERVERCFGFILE="server.cfg" \
  SRCDS_GAME="csgo" \
  SRCDS_GAMETYPE="1" \
  SRCDS_GAMEMODE="2" \
  SRCDS_GSLT="" \
  SRCDS_WSAPIKEY="" \
  SRCDS_RCON_PASSWORD="" \
  SRCDS_GAME_PASSWORD="" \
  SRCDS_PUBLIC="" \
  SRCDS_FASTDLURL="" \
  SRCDS_DEBUG_FAKE_STALE=""

WORKDIR /dist
ENTRYPOINT ["node", "--trace-warnings", "main.mjs"]
