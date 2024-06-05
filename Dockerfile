# syntax=docker/dockerfile:1

FROM debian:bullseye-slim
LABEL maintainer="pers.edwin@honkhost.gg"

USER root

RUN set -exu \
  && dpkg --add-architecture i386 \
  && sed -i 's/main/main contrib non-free/g' /etc/apt/sources.list \
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
    libicu67 \
    libicu-dev \
    python3 \
  && curl -fsSL https://deb.nodesource.com/setup_16.x | bash - \
  && apt-get -yq install nodejs \
  && apt-get clean && apt-get autoclean \
  && adduser --disabled-password --gecos container --home /home/container container \
  && mkdir -p /opt/steamcmd \
  && curl "http://media.steampowered.com/installer/steamcmd_linux.tar.gz" | tar xvzf - -C "/opt/steamcmd" \
  && chown container:container /opt/steamcmd

ENV NODE_ENV=production

COPY ./src /dist
COPY ./package.json /dist/package.json
COPY ./package-lock.json /dist/package-lock.json
RUN set -exu && cd /dist && npm install --production

USER container

RUN set -exu \
  && cd /home/container \
  && /opt/steamcmd/steamcmd.sh +quit

ENV USER=container \
  HOME="/home/container" \
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
