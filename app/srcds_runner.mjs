'use strict';

// This wraps srcds
// Managed by daemon.mjs

// Imports
import { default as path } from 'path';
import { default as child_process } from 'child_process';
import { default as net } from 'net';
import { default as whyisnoderunning } from 'why-is-node-running';
import { default as clog } from 'ee-log';

// TODO: make this come from an envvar (doesn't work with just process.env.DEBUG)
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
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
  redisPassword: process.env.REDIS_PASSWORD,
};

if (debug) clog.debug('Config:', config);

// Setup SRCDS command line options
// eslint-disable-next-line prettier/prettier
const srcdsCommandLine = [
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
const srcdsChild = child_process.spawn('/opt/srcds/srcds_linux', srcdsCommandLine, {
  cwd: '/opt/srcds',
  env: {
    HOME: '/home/steam',
    LD_LIBRARY_PATH: `${config.basedir}:${config.basedir}/bin`,
  },
});

// Connect srcds's stdin/out to ours
srcdsChild.stdout.pipe(process.stdout, { end: false });
srcdsChild.stderr.pipe(process.stderr, { end: false });
process.stdin.pipe(srcdsChild.stdin, { end: false });

// Watch stdout for update notifications
srcdsChild.stdout.on('data', (data) =>{
  data = data.toString();
  if (data.includes('MasterRequestRestart')) {
    console.log('\n\nServer update required\n\n');
  }
  // TODO: publish notification to redis to trigger srcds_downloader into doing the thing
  // TODO: stop srcds
  // TODO: wait for download_complete flag to be set
  // TODO: start srcds
});

// Set our exit code to srcds's exit code
srcdsChild.on('exit', (code) => {
  console.log(`\n\nSRCDS Exited with code ${code}\n\n`);
  process.exitCode = code;
});

// Handle SIGTERM - ask srcds to shutdown cleanly
process.on('SIGTERM', () => {
  console.log('SIGTERM received, exiting');
  shutdownSrcds(srcdsChild);
});

function shutdownSrcds(child) {
  // Prepare a sigkill if srcds doesn't exit within 30 seconds
  const timeout = setTimeout(() => {
    console.log('\n\nTimeout reached, sending SIGTERM to srcds');
    srcdsChild.kill('SIGTERM');
  }, 30000);

  // Ask SRCDS to exit cleanly
  // First 'say' and 'echo' the date the command was received
  child.stdin.write(`\n\nsay "QUIT command received at ${Date.now()}"\n\n`, 'utf8');
  child.stdin.write(`\n\necho "QUIT command received at ${Date.now()}"\n\n`, 'utf8');
  // Then send the 'quit' command
  child.stdin.write('\n\nquit\n\n', 'utf8', () => {
    console.log('\n\n"quit" command sent successfully\n\n');
    child.removeAllListeners();
    // When the srcdsChild quits
    child.on('exit', () => {
      clearTimeout(timeout);
    });
  });
}
