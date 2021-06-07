'use strict';

// Daemon
// Do not run by hand

// Imports
import { default as path } from 'path';
import { default as child_process } from 'child_process';
import { default as net } from 'net';
import { default as whyisnoderunning } from 'why-is-node-running';
import { default as clog } from 'ee-log';

/* Don't need this now that we're in a container
// We're using dotenv for now to load config from .env, but once we're containerized we'll just get them directly
import { default as dotenv } from 'dotenv';
// Populate process.env from .env
dotenv.config();
*/

const debug = true;

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
  gameDir: path.normalize('/opt/srcds'),
};

if (debug) clog.debug('Config:', config);
// Sub to redis update channel

// Setup SRCDS command line options
// eslint-disable-next-line prettier/prettier
const srcdsCommandLine = [
  `${config.gameDir}/srcds_run`,
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
if (debug) clog.debug('SRCDS Command Line:', srcdsCommandLine);

// Spawn SRCDS
const srcdsChild = child_process.spawn('bash', srcdsCommandLine, {
  cwd: '/opt/srcds',
  uid: 1000,
  gid: 1000,
  maxBuffer: 10240,
  env: {
    HOME: '/home/steam',
  },
});

// Create a telnet server for SRCDS console
const consoleServer = net.createServer((socket) => {
  socket.pipe(srcdsChild.stdin, { end: false });
  srcdsChild.stdout.pipe(socket, { end: false });
  srcdsChild.stderr.pipe(socket, { end: false });
  process.on('SIGINT', () => {
    socket.destroy();
  });
  srcdsChild.on('close', () => {
    socket.destroy();
  });
  consoleServer.on('close', () => {
    socket.destroy();
  });
});
consoleServer.listen({
  port: 28001,
  host: 'localhost',
});
consoleServer.on('listening', () => {
  console.log('SRCDS Console listening on localhost:28001');
});
consoleServer.on('connection', (socket) => {
  console.log(`SRCDS Console connection established from ${socket.remoteAddress}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, exiting');
  // Ask SRCDS to exit cleanly
  srcdsChild.stdin.write('quit\n', 'utf8', () => {
    console.log('"quit" command sent successfully');
    // When the child quits
    srcdsChild.on('close', (code) => {
      console.log(`SRCDS exited with code ${code}`);
      consoleServer.close();
    });
  });
});
