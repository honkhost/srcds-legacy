# syntax=docker/dockerfile:1

FROM debian:buster-slim

LABEL maintainer="pers.edwin@gmail.com"

ENV PUID=1000
ENV PGID=1000

ENV USER=steam
ENV HOMEDIR="/home/${USER}"
ENV STEAMCMDDIR="${HOMEDIR}/steamcmd"

ENV NODE_ENV=production

# Install SteamCMD and nodejs, Create $USER, Create $HOMEDIR
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
  && sed -i -e 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen \
  && dpkg-reconfigure --frontend=noninteractive locales \
  && useradd -u "${PUID}" -m "${USER}" \
  && su "${USER}" -c \
    "mkdir -p \"${STEAMCMDDIR}\" \
    && wget -qO- 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz' | tar xvzf - -C \"${STEAMCMDDIR}\" \
    && \"./${STEAMCMDDIR}/steamcmd.sh\" +quit \
    && mkdir -p \"${HOMEDIR}/.steam/sdk32\" \
    && ln -s \"${STEAMCMDDIR}/linux32/steamclient.so\" \"${HOMEDIR}/.steam/sdk32/steamclient.so\" \
    && ln -s \"${STEAMCMDDIR}/linux32/steamcmd\" \"${STEAMCMDDIR}/linux32/steam\" \
    && ln -s \"${STEAMCMDDIR}/steamcmd.sh\" \"${STEAMCMDDIR}/steam.sh\"" \
  && ln -s "${STEAMCMDDIR}/linux32/steamclient.so" "/usr/lib/i386-linux-gnu/steamclient.so" \
  && ln -s "${STEAMCMDDIR}/linux64/steamclient.so" "/usr/lib/x86_64-linux-gnu/steamclient.so" \
  && curl -fsSL https://deb.nodesource.com/setup_16.x | bash - \
  && apt install -yq nodejs \
  && apt-get -yq clean autoclean \
  && apt-get -yq autoremove \
  && rm -rf /var/lib/apt/lists/*

ENV SRCDS_BASEDIR='/opt/srcds'
ENV SRCDS_GAMEID='740'
ENV SRCDS_GAME="csgo"

ENV SRCDS_IP='0.0.0.0'
ENV SRCDS_PORT='27015'
ENV SRCDS_CLIENTPORT='27005'
ENV SRCDS_HLTVPORT='27020'

ENV SRCDS_TICKRATE='64'
ENV SRCDS_STARTUPMAP='de_nuke'
ENV SRCDS_SERVERCFGFILE='server.cfg'

ENV SRCDS_MAXPLAYERS='12'
ENV SRCDS_GAMETYPE='1'
ENV SRCDS_GAMEMODE='1'

ENV SRCDS_GSLT=''
ENV SRCDS_WSAPIKEY=''

COPY app/ ${HOMEDIR}/srcds_runner

WORKDIR ${HOMEDIR}/srcds_runner
ENTRYPOINT ["node", "srcds_runner.mjs"]

EXPOSE  27015/tcp \
        27015/udp \
        27020/udp
