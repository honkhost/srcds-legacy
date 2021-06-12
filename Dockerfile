# syntax=docker/dockerfile:1

FROM epers/sourchestrator-steamcmd-base:stable

LABEL maintainer="pers.edwin@gmail.com"

USER root
COPY ./app /srcds_runner
RUN set -x \
    && ls -alh /srcds_runner \
    && cd /srcds_runner \
    && npm install

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
    SRCDS_HLTVPORT='27120' \
    SRCDS_TICKRATE='64' \
    SRCDS_STARTUPMAP='de_nuke' \
    SRCDS_SERVERCFGFILE='server.cfg' \
    SRCDS_MAXPLAYERS='12' \
    SRCDS_GAMETYPE='1' \
    SRCDS_GAMEMODE='2' \
    SRCDS_GSLT='' \
    SRCDS_WSAPIKEY='' \
    REDIS_PASSWORD="" \
    NODE_ENV=production

EXPOSE  27015/tcp \
        27015/udp \
        27020/udp

WORKDIR /srcds_runner
CMD ["node", "srcds_daemon.mjs"]
