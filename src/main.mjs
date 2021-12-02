'use strict';

// Imports
// Built-ins
import { default as path } from 'path';
import { default as crypto } from 'crypto';
import { URL } from 'url';
import { default as Stream } from 'stream';
import { default as events } from 'events';

// External
import { default as clog } from 'ee-log';
import { default as pty } from 'node-pty';
import { default as Lock } from 'async-lock';
import { default as express } from 'express';
import { default as expressWS } from 'express-ws';
import { default as prometheus } from 'prom-client';

//
// Globals

// Loud but useful
const debug = process.env.DEBUG || true;

// Our identity - bail out really early if it isn't defined
const ident = process.env.SRCDS_IDENT || '';
if (ident === '') throw new Error('env var SRCDS_IDENT required');

//
// Baseline Directories
const homeDir = '/home/container';

// Location of steamcmd.sh - /home/container/steamcmd
const steamcmdDir = '/opt/steamcmd';

// Location where we save game files
const serverFilesDir = '/opt/serverfiles';

// Do we auto update?
const autoUpdate = process.env.SRCDS_AUTOUPDATE || 'true';

// Steamcmd proxy
const httpProxy = process.env.SRCDS_HTTP_PROXY || '';

// Force a validation of game files when starting/updating
const forceValidate = process.env.SRCDS_FORCE_VALIDATE || 'false';

// Websocket token
const staticWSToken = process.env.SRCDS_WS_STATIC_TOKEN || crypto.randomBytes(128).toString('base64');

// Locking - not strictly necessary, but nice to have
var lock = new Lock();

// Placeholder for our child
// TODO: don't think we need this here
var srcdsChild = undefined;

// Flags
var shutdownInProgress = false;
var updateInProgress = false;

// Streams to pipe up the websocket to srcds / steamcmd
const ws2srcdsPipe = new Stream.Readable();
ws2srcdsPipe._read = () => {};

const srcds2wsPipe = new Stream.Readable();
srcds2wsPipe._read = () => {};

// Print output from 'stats' command
const printStatsOutput = process.env.SRCDS_PRINT_STATS || false;

// Regex to match output of 'stats' command
const statsRegex = /(?:^|\n)\s*((?:[\d\.]+\s*){10})(?:$|\n)/;

// String to look for to run update
// Specified as a literal instead of a regex
const updateRequiredString = 'MasterRequestRestart\r\nYour server needs to be restarted in order to receive the latest update.\r\n';

//
// End globals

//
// EventEmitters
// TODO there has to be a better way
const statsEventTx = new events.EventEmitter();
const statsEventRx = new events.EventEmitter();

//
// SRCDS config
const srcdsConfig = {
  appid: '740', // Steam game ID
  ip: '0.0.0.0', // Bind address
  port: process.env.SRCDS_PORT || '27215', // Game port
  tickrate: process.env.SRCDS_TICKRATE || '64', // Tickrate
  maxPlayers: process.env.SRCDS_MAXPLAYERS || '20', // Maximum number of players
  startupMap: process.env.SRCDS_STARTUPMAP || 'de_nuke', // Startup map
  serverCfgFile: process.env.SRCDS_SERVERCFGFILE || 'server.cfg', // Main server configuration file
  game: process.env.SRCDS_GAME || 'csgo', // Mod name
  gameType: process.env.SRCDS_GAMETYPE || '1', // Game type
  gameMode: process.env.SRCDS_GAMEMODE || '2', // Game mode
  gslt: process.env.SRCDS_GSLT || '', // Gameserver Login Token
  wsapikey: process.env.SRCDS_WSAPIKEY || '', // Workshop API key
  rconPassword: process.env.SRCDS_RCON_PASSWORD, // RCON Password
  gamePassword: process.env.SRCDS_GAME_PASSWORD, // Game password
  allowEmptyGamePassword: process.env.SRCDS_PUBLIC || false, // Allow empty game password?
  fastDLUrl: new URL(process.env.SRCDS_FASTDLURL).toString() || '', // FastDL server
  fakeStale: process.env.SRCDS_DEBUG_FAKE_STALE || false,
};

// If no rcon password was supplied, set one now (can be changed later in cfg files)
if (srcdsConfig.rconPassword === '') {
  srcdsConfig.rconPassword = crypto.randomBytes(24).toString('base64');
  console.log(`[${timestamp()}]  No RCON password provided at startup, set to ${srcdsConfig.rconPassword}`);
}

// If no game password was supplied at startup, set one now (can be changed in cfg files)
// If both the password is empty and allowEmptyGamePassword, allow a blank game password at startup (can be changed later in cfg files)
if (srcdsConfig.gamePassword === '' && srcdsConfig.allowEmptyGamePassword === 'true') {
  console.log(
    `[${timestamp()}]  No Game password provided at startup and AllowEmptyGamePassword is true, server is publicly accessible!`,
  );
} else if (srcdsConfig.gamePassword === '') {
  srcdsConfig.gamePassword = crypto.randomBytes(24).toString('base64');
  console.log(`[${timestamp()}]  No Game password provided at startup, set to ${srcdsConfig.gamePassword}`);
}

// Build the srcds command line
const srcdsCommandLine = [
  srcdsConfig.fakeStale ? '-fake_stale_server' : '',
  '-usercon', // Enable rcon
  '-norestart', // We handle restarts ourselves
  `-ip ${srcdsConfig.ip}`, // Bind ip
  `-port ${srcdsConfig.port}`, // Bind port
  `-game ${srcdsConfig.game}`, // Mod name
  `-nohltv`, // Disable HLTV
  `-tickrate ${srcdsConfig.tickrate}`, // Tickrate
  `-maxplayers_override ${srcdsConfig.maxPlayers}`, // Maxplayers
  `-authkey ${srcdsConfig.wsapikey}`, // Workshop api key
  `+map ${srcdsConfig.startupMap}`, // Startup map
  `+servercfgfile ${srcdsConfig.serverCfgFile}`, // Main server configuration file
  `+game_type ${srcdsConfig.gameType}`, // Game type
  `+game_mode ${srcdsConfig.gameMode}`, // Game mode
  `+sv_setsteamaccount "${srcdsConfig.gslt}"`, // GSLT
  `+rcon_password "${srcdsConfig.rconPassword}"`, // RCON password
  `+sv_password "${srcdsConfig.gamePassword}"`, // Game password
  `+sv_downloadurl "\\"${srcdsConfig.fastDLUrl}\\""`, // FastDL url
  `+hostname "${ident}`, // Set the hostname at startup - can be overridden by config files later
];

// Some debug statements
// if (debug) clog.debug('process.env', process.env);
// if (debug) clog.debug('SRCDS config', srcdsConfig);
// if (debug) clog.debug('SRCDS command line', srcdsCommandLine);

//
// End srcds config

//
// Setup monitoring
const prometheusRegistry = new prometheus.Registry();
const metrics = {
  status: new prometheus.Gauge({
    name: 'srcds_status',
    help: "The server's status, 0 = offline/bad password, 1 = online",
    registers: [prometheusRegistry],
  }),
  cpu: new prometheus.Gauge({
    name: 'srcds_cpu',
    help: 'CPU usage',
    registers: [prometheusRegistry],
  }),
  netin: new prometheus.Gauge({
    name: 'srcds_netin',
    help: 'Incoming bandwidth, in kbps, received by the server',
    registers: [prometheusRegistry],
  }),
  netout: new prometheus.Gauge({
    name: 'srcds_netout',
    help: 'Incoming bandwidth, in kbps, sent by the server',
    registers: [prometheusRegistry],
  }),
  uptime: new prometheus.Gauge({
    name: 'srcds_uptime',
    help: "The server's uptime, in minutes",
    registers: [prometheusRegistry],
  }),
  maps: new prometheus.Gauge({
    name: 'srcds_maps',
    help: "The number of maps played on that server since it's start",
    registers: [prometheusRegistry],
  }),
  fps: new prometheus.Gauge({
    name: 'srcds_fps',
    help: "The server's tick (10 fps on idle, 64 fps for 64 ticks server, 128 fps for 128 ticks..)",
    registers: [prometheusRegistry],
  }),
  players: new prometheus.Gauge({
    name: 'srcds_players',
    help: 'The number of real players actually connected on the server',
    registers: [prometheusRegistry],
  }),
  svms: new prometheus.Gauge({
    name: 'srcds_svms',
    help: 'The ms per sim frame',
    registers: [prometheusRegistry],
  }),
  varms: new prometheus.Gauge({
    name: 'srcds_varms',
    help: 'The ms/frame variance',
    registers: [prometheusRegistry],
  }),
  tick: new prometheus.Gauge({
    name: 'srcds_tick',
    help: 'The time in MS per tick',
    registers: [prometheusRegistry],
  }),
};

prometheusRegistry.setDefaultLabels({
  ident: ident,
  appid: srcdsConfig.appid,
});

// End monitoring setup

//
// Setup express
var expressApp = express();
var expressWs = expressWS(expressApp, null, {
  wsOptions: {
    verifyClient: (info, callback) => {
      if (auth(info.req.headers['X-HonkHost-Instance-Token'])) {
        return callback(true);
      } else {
        return callback(false, 401, 'Unauthorized');
      }
    },
  },
});

expressApp.use((request, response, next) => {
  if (auth(request.headers['X-HonkHost-Instance-Token'])) {
    return next();
  } else {
    response.status(401).send('Unauthorized');
  }
});

// We declare this as a var here so we can shutdown the connection when srcds exits
const expressServer = expressApp.listen(3000);

expressApp.get('/metrics', (request, response) => {
  statsEventTx.emit('request', null);
  statsEventRx.on('complete', async () => {
    const toSend = await prometheusRegistry.metrics();
    // if (debug) clog.debug('send metrics', toSend);
    response.send(toSend);
    statsEventRx.removeAllListeners();
  });
});

// Setup the websocket for console
// We "hide" the route as /ws/${ident}
// Keeps it from being hit by bots at least
// And of course we auth it up above
expressApp.ws('/', (websocket, request) => {
  const srcIP = request.headers['x-forwarded-for'] || request.socket.remoteAddress;
  console.log(`[${timestamp()}]  [websocket console] Connected from IP ${srcIP}`);
  websocket.on('message', (message) => {
    // Take incoming websocket messages and dump them to srcdsChild
    console.error('Websocket message: ' + message.toString());
    ws2srcdsPipe.push(message.toString() + '\r\n');
    // srcdsChild.write(`${message}\n`);
  });

  // Take incoming stdout from srcdsChild and dump it to the websocket
  srcds2wsPipe.on('data', (data) => {
    data = data.toString();
    websocket.send(data);
  });

  // srcdsChild.onData((data) => {
  //   data = data.toString();
  //   websocket.send(data);
  // });
  websocket.on('close', () => {
    websocket.removeAllListeners();
  });
});

//
// End setup

//
// Begin logic
// First, check for updates
metrics.status.set(Number(0));
updateValidate(srcdsConfig.appid)
  .then((result) => {
    // If steamcmd didn't shit the bed, continue
    if (result != 'error') {
      // Start srcds
      spawnSrcds();
    } else {
      // If steamcmd died, bail out now
      throw new Error(`Update in state ${result}`);
    }
    return;
  })
  .catch((error) => {
    // If checkApplyUpdate throws, bail the fuck out
    throw new Error(error);
  });

process.on('SIGINT', () => {
  console.error('SIGINT');
});

//
// Functions

//
// Auth
// Very basic for now
function auth(token) {
  if (typeof token === undefined || !token || token.length === 0) {
    return false;
  } else if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(staticWSToken))) {
    return true;
  } else {
    return false;
  }
}

//
// Spawn SRCDS
// Handle sigterm while it's running
// Forward container stdin to srcds
// Handle automatic updates
// Automatically restart srcds
// TODO: do we want to do that? or allow nomad to restart container for us?
// Cleanup when shutdown is in progress
// Listen on a websocket for console
function spawnSrcds() {
  const gameLockStatus = lock.isBusy('game');
  const updateLockStatus = lock.isBusy('update');
  if (gameLockStatus) {
    // Locked somehow, bail out early
    throw new Error(`Locked: Game ${gameLockStatus}; Update ${updateLockStatus}`);
  } else {
    // Spawn srcds

    if (debug) clog.debug(`Spawning srcds at ${serverFilesDir}/srcds_linux with options`, srcdsCommandLine);

    console.log(`[${timestamp()}]  Spawning srcds at ${serverFilesDir}/srcds_linux:`);
    srcdsChild = pty.spawn(`${serverFilesDir}/srcds_linux`, srcdsCommandLine, {
      handleFlowControl: true,
      cwd: serverFilesDir,
      env: {
        LD_LIBRARY_PATH: `${serverFilesDir}:${serverFilesDir}/bin`,
        PATH: `${steamcmdDir}:${serverFilesDir}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
        HOME: homeDir,
        SRCDS_DIR: serverFilesDir,
        PWD: serverFilesDir,
      },
    });

    metrics.status.set(Number(1));

    ws2srcdsPipe.on('data', (data) => {
      data = data.toString();

      console.log(`[${timestamp()}]  [websocket console] ${data}`);
      srcdsChild.write(data);
    });

    statsEventTx.on('request', () => {
      srcdsChild.write('stats\r\n');
    });

    // Forward stdout from srcds to our own
    srcdsChild.onData((data) => {
      data = data.toString();
      // If we see "MasterRequestRestart" and autoupdate is enabled, trigger an update
      // eslint-disable-next-line prettier/prettier
      if (data === updateRequiredString && autoUpdate === 'true' && updateInProgress === false) {
        updateInProgress = true;
        console.log(`\n\n[${timestamp()}]  Server update required\n\n`);
        console.log(`\n\n[${timestamp()}]  Server will restart for update in 30 seconds\r\n\r\n`);
        srcdsChild.write(`\r\n\r\nsay Server update required\n\n`, 'utf8');
        srcdsChild.write(`\r\n\r\nsay Server will restart for update in 30 seconds\r\n\r\n`, 'utf8');
        setTimeout(() => {
          shutdownSrcds(srcdsChild, 'UPDATE')
            .then((exitcode) => {
              return;
            })
            .catch((error) => {
              throw error;
            });
        }, 30000); // 30 seconds
      }

      var parsedStats = data.match(statsRegex);
      var isStatsCommand = data.match(/stats\s+/);
      if (parsedStats || isStatsCommand) {
        parsedStats = parsedStats[0].split(/\s+/);
        // TODO drop the first and last elements, adjust below as necessary
        metrics.status.set(Number(1));
        metrics.cpu.set(Number(parsedStats[1]));
        metrics.netin.set(Number(parsedStats[2]));
        metrics.netout.set(Number(parsedStats[3]));
        metrics.uptime.set(Number(parsedStats[4]));
        metrics.maps.set(Number(parsedStats[5]));
        metrics.fps.set(Number(parsedStats[6]));
        metrics.players.set(Number(parsedStats[7]));
        metrics.svms.set(Number(parsedStats[8]));
        metrics.varms.set(Number(parsedStats[9]));
        metrics.tick.set(Number(parsedStats[10]));
        statsEventRx.emit('complete', null);
        if (printStatsOutput) {
          console.log(`[${timestamp()}]  ${data}`);
          srcds2wsPipe.push(data);
        }
      } else {
        console.log(`[${timestamp()}]  ${data}`);
        srcds2wsPipe.push(data);
      }
    });

    // When srcds exits
    srcdsChild.onExit((exit) => {
      console.log(
        `\n\n[${timestamp()}]  srcds_linux exited with code ${exit.exitCode} because of signal ${exit.signal}\n\n`,
      );
      // Do some cleanup
      srcdsChild.removeAllListeners();
      // Wait 5 seconds
      setTimeout(() => {
        // If we're shutting down, no-op and exit (other sigterm handler will finish cleanup for us)
        if (shutdownInProgress) {
          expressServer.close();
          return;
        } else {
          // Otherwise, check for an update and restart srcds
          updateValidate(srcdsConfig.appid)
            .then((result) => {
              spawnSrcds();
              return;
            })
            .catch((error) => {
              throw error;
            });
        }
      }, 5000);
    });

    // Initial sigterm handler
    // Set shutdownInProgress flag
    // Shutdown srcds cleanly
    process.on('SIGTERM', () => {
      console.log(`\n\n[${timestamp()}]  SIGTERM received, shutting down \n\n`);
      shutdownInProgress = true;
      shutdownSrcds(srcdsChild, 'SIGTERM')
        .then((exitCode) => {
          return;
        })
        .catch((error) => {
          throw error;
        });
    });
    return srcdsChild;
  }
}

// Shutdown SRCDS
// srcdsChild MUST be typeof child_process
function shutdownSrcds(srcdsChild, reason) {
  return new Promise((resolve, reject) => {
    if (srcdsChild) {
      reason = reason || 'unknown';
      // Prepare a sigkill if srcds doesn't exit within 10 seconds
      // TODO: implement this? nomad will sigkill us in 5 seconds (configurable?)
      // Ask SRCDS to exit cleanly
      // First 'say' and 'echo' the date the command was received

      srcdsChild.write(`\r\n\r\nsay 'quit' command received at ${timestamp()} [${reason}]\r\n\r\n`, 'utf8');
      // Then send the 'quit' command
      srcdsChild.write('\r\n\r\nquit\r\n\r\n');
      srcdsChild.onExit((exit) => {
        srcdsChild = undefined;
        return resolve(exit);
      });
    } else {
      clog.error('shutdownSrcds called with no child!');
      return reject(new Error('Parameter srcdsChild required'));
    }
  });
}

// Spawn steamcmd to check/apply/validate updates
// TODO: allow dynamic assignment of forceValidate
function updateValidate(appid) {
  return new Promise((resolve, reject) => {
    console.log(`[${timestamp()}]  Checking for update`);
    if (debug) clog.debug(`updateValidate(${appid})`);
    console.log(`[${timestamp()}]  Spawning steamcmd to check/validate ${appid}`);
    // Setup the steamcmd command line
    const installDir = path.normalize(serverFilesDir);
    var steamcmdCommandLine = [];
    // Is forceValidate set?
    // TODO: make this dynamic
    if (forceValidate === 'true') {
      if (debug) clog.debug('forceValidate true, forcing validation');

      console.log(`[${timestamp()}]  Forcing validation`);
      steamcmdCommandLine = [
        `+force_install_dir "${installDir}"`,
        `+login anonymous`,
        `+app_update ${appid} validate`,
        `+quit`,
      ];
    } else {
      // eslint-disable-next-line prettier/prettier
      steamcmdCommandLine = [
        `+force_install_dir "${installDir}"`,
        `+login anonymous`,
        `+app_update ${appid}`,
        `+quit`,
      ];
    }

    // Spawn steamcmd

    console.log(`[${timestamp()}]  Spawning steamcmd to update/validate`);
    const steamcmdChild = pty.spawn(`${steamcmdDir}/steamcmd.sh`, steamcmdCommandLine, {
      handleFlowControl: true,
      cwd: steamcmdDir,
      env: {
        LD_LIBRARY_PATH: `${steamcmdDir}/linux32`,
        http_proxy: httpProxy,
      },
    });

    // Handle SIGTERM when steamcmd is running
    process.on('SIGTERM', () => {
      steamcmdChild.kill('SIGTERM');
    });

    // When steamcmd outputs, output it to console
    steamcmdChild.onData((data) => {
      data = data.toString().replace('\r\n', '\n');

      console.log(`[${timestamp()}]  ${data}`);
      srcds2wsPipe.push(data);
    });

    // When steamcmd is done, return the exitcode
    steamcmdChild.onExit((code) => {
      console.log(`[${timestamp()}]  Steamcmd exited with code ${code.exitCode} because of signal ${code.signal}`);
      if (code.exitCode === 0) {
        updateInProgress = false;
        return resolve('complete');
      } else {
        return reject(new Error(`SteamCMD exited with code ${code.exitCode}`));
      }
    });
  });
}

function timestamp() {
  var now = new Date();
  now = now.toUTCString();
  return now;
}
