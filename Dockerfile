# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv

FROM ghcr.io/steamcmd/steamcmd:debian-trixie
LABEL maintainer="pers.edwin@gmail.com"

USER root

RUN set -exu \
  && apt-get -yq update \
  && apt-get -yq dist-upgrade \
  && apt-get -yq install --no-install-recommends \
    curl \
    tar \
    lib32stdc++6 \
    lib32gcc-s1 \
    lib32z1 \
    gcc \
    g++ \
    make \
    ca-certificates \
    libcurl4:i386 \
    libicu* \
    libicu-dev \
    python3 \
    python3-setuptools \
  && curl -fsSL https://deb.nodesource.com/setup_26.x | bash - \
  && apt-get -yq install nodejs \
  && apt-get clean && apt-get autoclean \
  && addgroup --gid 1000 server \
  && adduser --uid 1000 --gid 1000 --disabled-password --gecos server --home /home/server server

ENV NODE_ENV=production

COPY ./src /dist
COPY ./package.json /dist/package.json
COPY ./package-lock.json /dist/package-lock.json
RUN set -exu && cd /dist && npm install --omit=dev

USER server

ENV USER=server \
  HOME="/home/server" \
  NODE_ENV=production \
  DEBUG="true" \
  SRCDS_AUTOUPDATE="true" \
  SRCDS_HTTP_PROXY="" \
  SRCDS_FORCE_VALIDATE="" \
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
