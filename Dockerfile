# syntax=docker/dockerfile:1

FROM debian:buster-slim

LABEL maintainer="pers.edwin@gmail.com"

USER root
RUN set -x \
  && export DEBIAN_FRONTEND=noninteractive \
  && dpkg --add-architecture i386 \
  && apt-get -yq update \
  && apt-get -yq install --no-install-recommends --no-install-suggests \
    lib32stdc++6 \
    lib32gcc1 \
    wget \
    ca-certificates \
    nano \
    libsdl2-2.0-0:i386 \
    curl \
    locales \
    procps \
    tar \
  && sed -i -e 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen \
  && dpkg-reconfigure --frontend=noninteractive locales \
  && curl -fsSL https://deb.nodesource.com/setup_16.x | bash - \
  && apt-get -yq update \
  && apt-get -yq install nodejs \
  && apt-get -yq clean autoclean \
  && rm -rf /var/lib/apt/lists/* \
  && adduser --disabled-password --gecos container --home /home/container container \
  && ln -sf "/home/container/steamcmd/linux32/steamclient.so" "/usr/lib/i386-linux-gnu/steamclient.so" \
  && ln -sf "/home/container/steamcmd/linux64/steamclient.so" "/usr/lib/x86_64-linux-gnu/steamclient.so" 

USER container
ENV USER=container \
    HOME="/home/container" \
    HOMEDIR="/home/container" \
    STEAMCMDDIR="/home/container/steamcmd" \
    SRCDS_BASEDIR="/home/container/srcds" \
    SRCDS_APPID='740' \
    SRCDS_GAME="csgo" \
    SRCDS_HOSTNAME="csgo-server" \
    SRCDS_PORT='27115' \
    SRCDS_IP='0.0.0.0' \
    SRCDS_CLIENTPORT='27005' \
    SRCDS_HLTVPORT='27020' \
    SRCDS_TICKRATE='64' \
    SRCDS_STARTUPMAP='de_nuke' \
    SRCDS_SERVERCFGFILE='server.cfg' \
    SRCDS_MAXPLAYERS='12' \
    SRCDS_GAMETYPE='1' \
    SRCDS_GAMEMODE='2' \
    SRCDS_GSLT='' \
    SRCDS_WSAPIKEY=''

RUN set -x \
    && mkdir -p "/home/container/steamcmd" \
    && cd "/home/container" \
    && wget -qO- 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz' | tar xvzf - -C "/home/container/steamcmd" \
    && "/home/container/steamcmd/steamcmd.sh" +quit \
    && mkdir -p "/home/container/.steam/sdk32" \
    && ln -s "/home/container/steamcmd/linux32/steamclient.so" "/home/container/.steam/sdk32/steamclient.so"

COPY ./app /srcds_runner

EXPOSE  27015/tcp \
        27015/udp \
        27020/udp

WORKDIR /home/container
CMD ["node", "/runner/daemon.mjs"]
