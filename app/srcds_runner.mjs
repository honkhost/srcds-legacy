'use strict';

// Daemon
// Do not run by hand

// Imports
import { default as path } from 'path';
import { default as child_process } from 'child_process';

// We're using dotenv for now to load config from .env, but once we're containerized we'll just get them directly
import { default as dotenv } from 'dotenv';
// Populate process.env from .env
dotenv.config();

const config = {
  basedir: process.env.SRCDS_BASEDIR,
  ident: process.env.SRCDS_IDENT,
  gameid: process.env.SRCDS_GAMEID,
  game: process.env.SRCDS_GAME,
  ip: process.env.SRCDS_IP,
  port: process.env.SRCDS_PORT,
  clientPort: process.env.SRCDS_CLIENTPORT,
  hltvPort: process.env.SRCDS_HLTVPORT,
  tickrate: process.env.SRCDS_TICKRATE,
  maxPlayers: process.env.SRCDS_MAXPLAYERS,
  startupMap: process.env.SRCDS_STARTUPMAP,
  serverCfgFile: process.env.SRCDS_SERVERCFGFILE,
  gameType: process.env.SRCDS_GAMETYPE,
  gameMode: process.env.SRCDS_GAMEMODE,
  gslt: process.env.SRCDS_GSLT,
  wsapikey: process.env.SRCDS_WSAPIKEY,
};

console.log(config);
// Sub to redis update channel

// Start srcds
const gameDir = path.normalize('/opt/srcds');

// eslint-disable-next-line prettier/prettier
const srcdsCommandLine = [
  `${gameDir}/srcds_run`,
  `-game ${config.game}`,
  `-usercon`,
  `-ip ${config.ip}`,
  `-port ${config.port}`,
  `+clientport ${config.clientPort}`,
  `+tv_port ${config.hltvPort}`,
  `+sv_setsteamaccount ${config.gslt}`,
  `-tickrate ${config.tickrate}`,
  `+map ${config.startupMap}`,
  `+servercfgfile ${config.serverCfgFile}`,
  `-maxplayers_override ${config.maxPlayers}`,
  `+game_type ${config.gameType}`,
  `+game_mode ${config.gameMode}`,
  `-authkey ${config.wsapikey}`,
  `-nobreakpad`,
];

console.log(srcdsCommandLine);

const srcdsChild = child_process.spawn('bash', srcdsCommandLine, {
  cwd: '/opt/srcds',
  uid: 1000,
  gid: 1000,
  env: {
    HOME: '/home/steam',
  },
});

srcdsChild.stdout.on('data', (data) => {
  console.log('stdout: ' + data);
});

srcdsChild.stderr.on('data', (data) => {
  console.log('stderr: ' + data);
});

srcdsChild.on('close', (code) => {
  console.log(`Child exited with code ${code}`);
});
