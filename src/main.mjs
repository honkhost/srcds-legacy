'use strict';

console.log(`\n\n--- Logs begin at ${timestamp()} ---\n\n`);
console.error(`\n\n--- Logs begin at ${timestamp()} ---\n\n`);

// Imports
// Built-ins
import { default as path } from 'path';
import { default as crypto } from 'crypto';
import { default as Stream } from 'stream';
import { default as events } from 'events';
import { default as fs } from 'fs';

// External
import { default as clog } from 'ee-log';
import { default as pty } from 'node-pty';
import { default as express } from 'express';
import { default as session } from 'express-session';
import { tinyws } from 'tinyws';
import { default as prometheus } from 'prom-client';
import { default as pidusage } from 'pidusage';
import { default as Keycloak } from 'keycloak-connect';
import { default as why } from 'why-is-node-running';

console.log(`
 _                    _     _                  _                    
| |                  | |   | |                | |                   
| |__    ___   _ __  | | __| |__    ___   ___ | |_      __ _   __ _ 
| '_ \\  / _ \\ | '_ \\ | |/ /| '_ \\  / _ \\ / __|| __|    / _' | / _' |
| | | || (_) || | | ||   < | | | || (_) |\\__ \\| |_  _ | (_| || (_| |
|_| |_| \\___/ |_| |_||_|\\_\\|_| |_| \\___/ |___/ \\__|(_) \\__, | \\__, |
                                                        __/ |  __/ |
                                                       |___/  |___/ 
`);

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
const startupValidate = parseBool(process.env.SRCDS_STARTUP_VALIDATE) || false;

// Websocket token
var staticConsoleToken =
  `Bearer ${process.env.SRCDS_CONSOLE_STATIC_TOKEN}` || `Bearer ${crypto.randomBytes(128).toString('base64')}`;

// Websocket token
var staticMetricsToken =
  `Bearer ${process.env.METRICS_STATIC_TOKEN}` || `Bearer ${crypto.randomBytes(128).toString('base64')}`;

// Placeholder for our child
// TODO: don't think we need this here
var srcdsChild = undefined;

// Flags
var shutdownInProgress = false;
var updateInProgress = false;
var restartInProgress = false;

// Print output from 'stats' command
// This is toggled back and forth by the metrics poller
var printStatsOutput = false;

// Streams to pipe up the websocket to srcds / steamcmd
const ws2srcdsPipe = new Stream.Readable();
ws2srcdsPipe._read = () => {};

const srcds2wsPipe = new Stream.Readable();
srcds2wsPipe._read = () => {};

// Regex to match output of 'stats' command
// eslint-disable-next-line no-useless-escape,security/detect-unsafe-regex
const statsRegex = /(?:^|\n)\s*((?:[\d\.]+\s*){10})(?:$|\n)/;
const statsHeaderRegex =
  /\s*(?:CPU)\s*(?:NetIn)\s*(?:NetOut)\s*(?:Uptime)\s*(?:Maps)\s*(?:FPS)\s*(?:Players)\s*(?:Svms)\s*(?:\+-ms)\s*(?:~tick)/;

// String to look for to run update
// Specified as a literal instead of a regex
// eslint-disable-next-line prettier/prettier
const updateRequiredString = 'MasterRequestRestart\r\nYour server needs to be restarted in order to receive the latest update.\r\n';

//
// End globals

//
// EventEmitters
// TODO there has to be a better way
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
  allowEmptyGamePassword: parseBool(process.env.SRCDS_PUBLIC) || false, // Allow empty game password?
  fastDLUrl: process.env.SRCDS_FASTDL_URL || '', // FastDL server
  fakeStale: parseBool(process.env.SRCDS_DEBUG_FAKE_STALE) || false,
};

// If no rcon password was supplied, set one now (can be changed later in cfg files)
if (srcdsConfig.rconPassword === '') {
  srcdsConfig.rconPassword = crypto.randomBytes(24).toString('base64');
  console.log(`[${timestamp()}]  No RCON password provided at startup, set to ${srcdsConfig.rconPassword}`);
}

// If no game password was supplied at startup, set one now (can be changed in cfg files)
// If both the password is empty and allowEmptyGamePassword, allow a blank game password at startup (can be changed later in cfg files)
if (srcdsConfig.gamePassword === '' && srcdsConfig.allowEmptyGamePassword) {
  console.log(
    `[${timestamp()}]  No Game password provided at startup and AllowEmptyGamePassword is true, server is publicly accessible!`,
  );
} else if (srcdsConfig.gamePassword === '') {
  srcdsConfig.gamePassword = crypto.randomBytes(24).toString('base64');
  console.log(`[${timestamp()}]  No Game password provided at startup, set to ${srcdsConfig.gamePassword}`);
}

// Build the srcds command line
const srcdsCommandLine = [
  '-usercon', // Enable rcon
  '-norestart', // We handle restarts ourselves
  '-ip',
  srcdsConfig.ip, // Bind ip
  '-port',
  srcdsConfig.port, // Bind port
  '-game',
  srcdsConfig.game, // Mod name
  '-nohltv', // Disable HLTV
  '-tickrate',
  srcdsConfig.tickrate, // Tickrate
  '-maxplayers_override',
  srcdsConfig.maxPlayers, // Maxplayers
  '-authkey',
  srcdsConfig.wsapikey, // Workshop api key
  '+map',
  srcdsConfig.startupMap, // Startup map
  '+servercfgfile',
  srcdsConfig.serverCfgFile, // Main server configuration file
  '+game_type',
  srcdsConfig.gameType, // Game type
  '+game_mode',
  srcdsConfig.gameMode, // Game mode
  '+sv_setsteamaccount',
  srcdsConfig.gslt, // GSLT
  '+rcon_password',
  srcdsConfig.rconPassword, // RCON password
  '+sv_password',
  srcdsConfig.gamePassword, // Game password
  '+hostname',
  ident, // Set the hostname at startup - can be overridden by config files later
  // '+sv_downloadurl', srcdsConfig.fastDLUrl, // FastDL url
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
    help: 'CPU usage as reported by srcds',
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
  memory: new prometheus.Gauge({
    name: 'srcds_memory',
    help: 'SRCDS memory usage',
    registers: [prometheusRegistry],
  }),
  real_cpu: new prometheus.Gauge({
    name: 'srcds_real_cpu',
    help: 'SRCDS real cpu usage',
    registers: [prometheusRegistry],
  }),
};

prometheusRegistry.setDefaultLabels({
  ident: ident,
  appid: srcdsConfig.appid,
  instance: ident,
  server: ident,
});

// End monitoring setup

//
// Setup express

// Keycloak stuff
Keycloak.prototype.redirectToLogin = (request) => {
  var dashReqMatcher = /\/dash\//i;
  return dashReqMatcher.test(request.originalUrl || request.url);
};

const keycloakConfig = {
  'realm': 'honkhost.dev',
  'bearer-only': true,
  'auth-server-url': 'https://honkhost.dev/auth/',
  'ssl-required': 'external',
  'resource': `instance.${ident}.gameserver`,
  'verify-token-audience': true,
  'use-resource-role-mappings': true,
  'confidential-port': 0,
};

var keycloak = new Keycloak(
  {
    secret: crypto.randomBytes(128).toString('base64'),
    resave: false,
    saveUninitialized: false,
  },
  keycloakConfig,
);

var expressApp = express();
expressApp.set('trust proxy', true);

expressApp.use(keycloak.middleware());

expressApp.use('/v1/metrics', (request, response, next) => {
  const token = request.headers['authorization'];
  // Do some auth
  try {
    if (metricsAuth(token)) {
      return next();
    } else {
      response.status(401).send('Unauthorized');
    }
  } catch (error) {
    clog.error(error);
    response.status(401).send('Unauthorized');
  }
});

// We declare this as a var here so we can shutdown the connection when srcds exits
const expressServer = expressApp.listen(3000);

expressApp.get('/v1/metrics', async (request, response) => {
  const toSend = await prometheusRegistry.metrics();
  response.send(toSend);
});

expressApp.get('/v1/healthcheck', (request, response) => {
  response.send('ok');
});

// Setup the websocket for console
// We "hide" the route as /ws/${ident}
// Keeps it from being hit by bots at least
// And of course we auth it up above
// keycloak.protect(`instance.${ident}.gameserver:websocket`),
expressApp.use(
  '/v1/ws',
  tinyws(),
  keycloak.protect(`instance.${ident}.gameserver:websocket`),
  async (request, response) => {
    if (request.ws) {
      const ws = await request.ws();
      const srcIP = request.headers['x-forwarded-for'].split(',')[0] || request.socket.remoteAddress;
      console.log(`[${timestamp()}]  [websocket console] Connected from IP ${srcIP}`);
      ws.on('message', (message) => {
        // Take incoming websocket messages and dump them to srcdsChild
        console.error('Websocket message: ' + message.toString());
        ws2srcdsPipe.push(message.toString() + '\n');
      });
      // Take incoming stdout from srcdsChild and dump it to the websocket
      srcds2wsPipe.on('data', (data) => {
        data = data.toString();
        ws.send(data);
      });
      // When we get sigterm and a websocket is open:
      // Start a 1 second interval to check again
      // If srcds is exited, close the websocket
      // TODO: upper limit
      const websocketSigterm = () => {
        const interval = setInterval(() => {
          try {
            if (typeof srcdsChild === 'undefined') {
              clearInterval(interval);
              ws.close(1012, 'sigterm received');
              console.error('closed websocket');
            } else {
              console.error('srcds still running, typeof srcdsChild:');
              console.error(typeof srcdsChild);
              // noop, continue waiting
            }
          } catch (error) {
            clog.error(error);
            clearInterval(interval);
            ws.close(1012, 'sigterm received');
            console.error('closed websocket');
          }
        }, 1000);
      };
      ws.on('close', () => {
        clog.debug('Websocket connection closed');
        ws.removeAllListeners();
        srcds2wsPipe.removeAllListeners();
        process.removeListener('SIGTERM', websocketSigterm);
      });
      process.once('SIGTERM', websocketSigterm);
    } else {
      response.end();
    }
  },
);

//
// End setup

//
// Begin logic
// First, check for updates
metrics.status.set(Number(0));
updateValidate(srcdsConfig.appid, startupValidate)
  .then((result) => {
    // If steamcmd didn't shit the bed, continue
    if (result != 'error') {
      if (shutdownInProgress || updateInProgress) {
        // noop for now
      } else {
        // Start srcds
        checkCreateAutoExec();
        spawnSrcds();
      }
    } else {
      // If steamcmd died, bail out now
      throw new Error(`Update in state ${result}`);
    }
    return;
  })
  .catch((error) => {
    // If checkApplyUpdate throws, bail the fuck out
    clog.error(error);
  });

// For debugging
process.on('SIGTERM', () => {
  console.error('SIGTERM');
  setTimeout(() => {
    why();
  }, 10000).unref();
});

process.on('SIGINT', () => {
  console.error('SIGINT');
});

//
// Functions

//
// Metrics auth
// Very basic for now
function metricsAuth(token) {
  if (typeof token === undefined || !token || token.length === 0) {
    return false;
  } else if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(staticMetricsToken))) {
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
  // Spawn srcds
  metrics.uptime.set(Number(0));

  // if (debug) clog.debug(`Spawning srcds at ${serverFilesDir}/srcds_linux with options`, srcdsCommandLine);

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
      http_proxy: httpProxy,
    },
  });

  metrics.status.set(Number(1));

  ws2srcdsPipe.on('data', (data) => {
    data = data.toString();

    console.log(`[${timestamp()}]  [websocket console] ${data}`);
    srcdsChild.write(data);
  });

  expressApp.post('/v1/restart', keycloak.protect(`instance.${ident}.gameserver:restart`), (request, response) => {
    restartInProgress = true;
    const jobUid = crypto.randomBytes(8).toString('hex');
    const jobUrl = `https://${request.hostname}${request.headers['x-forwarded-prefix']}/v1/job/${jobUid}`;
    var jobStatus = 'running';
    response.send({
      jobUrl: jobUrl,
      jobUid: jobUid,
    });
    shutdownSrcds(srcdsChild, 'RESTART')
      .then(() => {
        spawnSrcds();
        jobStatus = 'complete';
        restartInProgress = false;
        // response.send('complete');
        return;
      })
      .catch((error) => {
        throw error;
      });
    expressApp.get(`/v1/job/${jobUid}`, (request, response) => {
      response.send(jobStatus);
    });
  });

  expressApp.post('/v1/update', keycloak.protect(`instance.${ident}.gameserver:update`), (request, response) => {
    restartInProgress = true;
    const jobUid = crypto.randomBytes(8).toString('hex');
    const jobUrl = `https://${request.hostname}${request.headers['x-forwarded-prefix']}/v1/job/${jobUid}`;
    var jobStatus = 'running';
    response.send({
      jobUrl: jobUrl,
      jobUid: jobUid,
    });
    shutdownSrcds(srcdsChild, 'UPDATE')
      .then(() => {
        // eslint-disable-next-line promise/no-nesting
        updateValidate(srcdsConfig.appid, false)
          .then(() => {
            spawnSrcds();
            restartInProgress = false;
            jobStatus = 'complete';
            return;
          })
          .catch((error) => {
            throw error;
          });

        return;
      })
      .catch((error) => {
        throw error;
      });
    expressApp.get(`/v1/job/${jobUid}`, (request, response) => {
      response.send(jobStatus);
    });
  });

  expressApp.post('/v1/validate', keycloak.protect(`instance.${ident}.gameserver:validate`), (request, response) => {
    restartInProgress = true;
    const jobUid = crypto.randomBytes(8).toString('hex');
    const jobUrl = `https://${request.hostname}${request.headers['x-forwarded-prefix']}/v1/job/${jobUid}`;
    var jobStatus = 'running';
    response.send({
      jobUrl: jobUrl,
      jobUid: jobUid,
    });
    shutdownSrcds(srcdsChild, 'RESTART')
      .then(() => {
        // eslint-disable-next-line promise/no-nesting
        updateValidate(srcdsConfig.appid, true)
          .then(() => {
            spawnSrcds();
            restartInProgress = false;
            jobStatus = 'complete';
            return;
          })
          .catch((error) => {
            throw error;
          });
        return;
      })
      .catch((error) => {
        throw error;
      });
    expressApp.get(
      `/v1/job/${jobUid}`,
      keycloak.protect(`instance.${ident}.gameserver:read-job-status`),
      (request, response) => {
        response.send(jobStatus);
      },
    );
  });

  // Metrics
  const statsInterval = setInterval(() => {
    printStatsOutput = false;
    srcdsChild.write('stats\r\n');
    pidusage(srcdsChild.pid, (error, stats) => {
      metrics.real_cpu.set(Number(stats.cpu));
      metrics.memory.set(Number(stats.memory));
    });
    statsEventRx.once('complete', async () => {
      printStatsOutput = true;
    });
  }, 15000);

  // Forward stdout from srcds to our own
  // TODO: refactor this, too many conditionals, has to be a better way
  srcdsChild.onData((rawData) => {
    rawData = rawData.toString();
    var dataArray = rawData.split('\r\n');
    for (let i = 0; i < dataArray.length; i++) {
      // eslint-disable-next-line security/detect-object-injection
      var data = dataArray[i];
      if (data != '') {
        // If we see "MasterRequestRestart" and autoupdate is enabled, trigger an update
        // eslint-disable-next-line prettier/prettier
          if (data === updateRequiredString && autoUpdate === 'true' && updateInProgress === false) {
          updateInProgress = true;
          const msg1 = `\n--- [${timestamp()}]  Server update required ---\n`;
          const msg2 = `\n--- [${timestamp()}]  Server will restart for update in 30 seconds ---\n`;
          process.stdout.write(msg1);
          process.stdout.write(msg2);
          srcds2wsPipe.push(msg1);
          srcds2wsPipe.push(msg2);
          srcdsChild.write(`\r\nsay Server update required\r\n`, 'utf8');
          srcdsChild.write(`\r\nsay Server will restart for update in 30 seconds\r\n`, 'utf8');
          setTimeout(() => {
            shutdownSrcds(srcdsChild, 'UPDATE')
              .then(() => {
                return;
              })
              .catch((error) => {
                throw error;
              });
          }, 30000); // 30 seconds
        }

        const isStatsCommandPartial = data.match(/^(?:[sta]+)$|^(?:st?a?t?s?)$/);
        const isStatsHeader = data.match(statsHeaderRegex);
        var parsedStats = data.match(statsRegex);
        if (isStatsCommandPartial || isStatsHeader || parsedStats) {
          try {
            if (parsedStats || isStatsHeader) {
              if (printStatsOutput) {
                process.stdout.write(`[${timestamp()}]  ${data}\n`);
                srcds2wsPipe.push(data);
              }
              if (parsedStats) {
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
              }
            }
          } catch (error) {
            clog.error(error);
            // log and no-op
          }
        } else {
          process.stdout.write(`[${timestamp()}]  ${data}\n`);
          srcds2wsPipe.push(data);
        }
      }
    }
  });

  // When srcds exits
  srcdsChild.onExit((exit) => {
    console.log(
      `\n\n[${timestamp()}]  srcds_linux exited with code ${exit.exitCode} because of signal ${exit.signal}\n\n`,
    );
    metrics.status.set(Number(0));
    // Do some cleanup
    srcdsChild.removeAllListeners();
    srcdsChild = undefined;
    // If we're shutting down, no-op and exit (other sigterm handler will finish cleanup for us)
    if (shutdownInProgress) {
      expressServer.close();
      clearInterval(statsInterval);
      ws2srcdsPipe.removeAllListeners();
      return;
    } else if (restartInProgress) {
      // Someone else is handling restart for us, no-op
      clearInterval(statsInterval);
      ws2srcdsPipe.removeAllListeners();
      return;
    } else {
      // Otherwise, check for an update and restart srcds
      clearInterval(statsInterval);
      ws2srcdsPipe.removeAllListeners();
      updateValidate(srcdsConfig.appid, false)
        .then(() => {
          spawnSrcds();
          return;
        })
        .catch((error) => {
          throw error;
        });
    }
  });

  // Initial sigterm handler
  // Set shutdownInProgress flag
  // Shutdown srcds cleanly
  process.once('SIGTERM', () => {
    console.log(`\n\n[${timestamp()}]  SIGTERM received, shutting down \n\n`);
    shutdownInProgress = true;
    ws2srcdsPipe.removeAllListeners();
    clearInterval(statsInterval);
    try {
      if (typeof srcdsChild.pid === 'number') {
        shutdownSrcds(srcdsChild, 'SIGTERM')
          .then(() => {
            return;
          })
          .catch((error) => {
            throw error;
          });
      }
    } catch (error) {
      if (error.message != "Cannot read properties of undefined (reading 'pid')") {
        clog.error(error);
      }
    }
  });
  return srcdsChild;
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

      srcdsChild.write(`\r\nsay 'quit' command received at ${timestamp()} [${reason}]\r\n\r\n`, 'utf8');
      // Then send the 'quit' command
      srcdsChild.write('\r\nquit\r\n');
      srcdsChild.onExit((exit) => {
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
function updateValidate(appid, validate) {
  return new Promise((resolve, reject) => {
    console.log(`[${timestamp()}]  Checking for update`);
    if (debug) clog.debug(`updateValidate(${appid})`);
    console.log(`[${timestamp()}]  Spawning steamcmd to check/validate ${appid}`);
    // Setup the steamcmd command line
    const installDir = path.normalize(serverFilesDir);
    var steamcmdCommandLine = [];
    // Is forceValidate set?
    // TODO: make this dynamic
    if (validate) {
      console.log(`[${timestamp()}]  Forcing validation`);
      metrics.status.set(Number(3));
      metrics.uptime.set(Number(0));
      steamcmdCommandLine = [
        `+force_install_dir "${installDir}"`,
        `+login anonymous`,
        `+app_update ${appid} validate`,
        `+quit`,
      ];
    } else {
      metrics.status.set(Number(2));
      metrics.uptime.set(Number(0));
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
    process.once('SIGTERM', () => {
      shutdownInProgress = true;
      steamcmdChild.kill('SIGTERM');
    });

    // When steamcmd outputs, output it to console
    steamcmdChild.onData((rawData) => {
      rawData = rawData.toString();
      var dataArray = rawData.split('\r\n');
      for (let i = 0; i < dataArray.length; i++) {
        // eslint-disable-next-line security/detect-object-injection
        var data = dataArray[i];
        if (data != '') {
          process.stdout.write(`[${timestamp()}]  ${data}\n`);
          srcds2wsPipe.push(data);
        }
      }
    });

    // When steamcmd is done, return the exitcode
    steamcmdChild.onExit((code) => {
      steamcmdChild.removeAllListeners();
      console.log(`[${timestamp()}]  Steamcmd exited with code ${code.exitCode} because of signal ${code.signal}`);
      if (shutdownInProgress) {
        metrics.status.set(Number(0));
        expressServer.close();
        ws2srcdsPipe.removeAllListeners();
        return;
      } else if (restartInProgress) {
        // Someone else is handling restart for us, no-op
        ws2srcdsPipe.removeAllListeners();
        return resolve('complete');
      } else if (code.exitCode === 0) {
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

function parseBool(string) {
  if (string) {
    switch (string.toLowerCase().trim()) {
      case 'true':
      case 'yes':
      case '1':
        return true;

      case 'false':
      case 'no':
      case '0':
      case null:
        return false;
      default:
        return Boolean(string);
    }
  } else {
    return false;
  }
}

function checkCreateAutoExec() {
  const autoExecPath = path.normalize(`${serverFilesDir}/${srcdsConfig.game}/cfg`);
  const autoExecFile = path.normalize(`${autoExecPath}/autoexec.cfg`);
  const autoExecTemplate = `

// This file auto-generated by HonkHost startup provisioning system.
// It will not be overwritten. If it is removed, it will be recreated.

echo "--- start autoexec.cfg ---"

// Ensure we can be considered a real server by the GCs
sv_lan "0"

// Disable in-engine upload/download, enable fast-dl
sv_allowupload "0"
sv_allowdownload "0"
sv_downloadurl "${srcdsConfig.fastDLUrl}"

// User ban - Server banlist based on user steam ID.
exec banned_user.cfg
// IP ban - Server banlist based on user IP.
exec banned_ip.cfg

// Write ID - Writes a list of permanently-banned user IDs to banned_user.cfg.
writeid
// Write IP - Save the ban list to banned_ip.cfg.
writeip

// Tell the GC we're alive
heartbeat

echo "--- end autoexec.cfg ---"

`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(autoExecPath)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.mkdirSync(autoExecPath, { recursive: true });
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(autoExecFile)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(autoExecFile, autoExecTemplate, (error) => {
      if (error) clog.error(error);
      clog.debug('autoexec created');
      return;
    });
  } else {
    clog.debug('autoexec already exists');
    return;
  }
}
