'use strict';

// Imports
// Built-ins
import { default as path } from 'path';
import { default as readline } from 'readline';
// External
import { default as Redis } from 'ioredis';
import { default as clog } from 'ee-log';
import { default as Redlock } from 'redlock';
import { default as pty } from 'node-pty';
import { default as why } from 'why-is-node-running';

// Globals
// Loud but useful
const debug = process.env.DEBUG || true;

// What to do when we .catch() an error
const errorAction = process.env.ERRACTION || 'throw';

const ident = process.env.SRCDS_IDENT || 'template';

const isTrustedUpdateSource = process.env.SRCDS_TRUSTUPDDATE || false;

// Baseline Directories
const homeDir = process.env.HOME || '/home/container';
// Location of steamcmd.sh - /home/container/steamcmd
const steamcmdDir = process.env.STEAMCMDDIR || '/opt/steamcmd';
// Location where we save game files - will NOT <appid> appended - /opt/serverfiles
const serverFilesDir = process.env.SERVERFILESDIR || '/opt/serverfiles';

// Redis config
const redisHost = process.env.REDIS_HOST || 'redis';
const redisPort = Number.parseInt(process.env.REDIS_PORT) || '6379';
const redisPassword = process.env.REDIS_PASSWORD || 'somepasswordverystronk';
const redisDB = process.env.REDIS_DB || '11';

// SRCDS config
const srcdsConfig = {
  appid: process.env.SRCDS_APPID || '740',
  //game: process.env.SRCDS_GAME || '/home/container/srcds/csgo',
  ip: process.env.SRCDS_IP || '0.0.0.0',
  port: process.env.SRCDS_PORT || '27015',
  clientPort: process.env.SRCDS_CLIENTPORT || '27005',
  hltvPort: process.env.SRCDS_HLTVPORT || '27020',
  tickrate: process.env.SRCDS_TICKRATE || '64',
  maxPlayers: process.env.SRCDS_MAXPLAYERS || '20',
  startupMap: process.env.SRCDS_STARTUPMAP || 'de_nuke',
  serverCfgFile: process.env.SRCDS_SERVERCFGFILE || 'server.cfg',
  gameType: process.env.SRCDS_GAMETYPE || '1',
  gameMode: process.env.SRCDS_GAMEMODE || '2',
  gslt: process.env.SRCDS_GSLT || '',
  wsapikey: process.env.SRCDS_WSAPIKEY || '',
};

const srcdsCommandLine = [
  `--login`,
  `${serverFilesDir}/srcds_run`,
  `-usercon`,
  `-nobreakpad`,
  //`-game ${srcdsConfig.game}`,
  `-ip ${srcdsConfig.ip}`,
  `-port ${srcdsConfig.port}`,
  `-nohltv`,
  `-tickrate ${srcdsConfig.tickrate}`,
  `+map ${srcdsConfig.startupMap}`,
  `+servercfgfile ${srcdsConfig.serverCfgFile}`,
  `-maxplayers_override ${srcdsConfig.maxPlayers}`,
  `+game_type ${srcdsConfig.gameType}`,
  `+game_mode ${srcdsConfig.gameMode}`,
  `+sv_setsteamaccount ${srcdsConfig.gslt}`,
  `-authkey ${srcdsConfig.wsapikey}`,
];

const redisConfig = {
  port: redisPort,
  host: redisHost,
  password: redisPassword,
  db: redisDB,
}

const redis = new Redis(redisConfig)
const redisSub = new Redis(redisConfig)
const redisLockClient = new Redis(redisConfig)

// RedLock client
const redisLock = new Redlock([redisLockClient], {
  retryCount: 2,
  retryDelay: 5000,
  retryJitter: 1000,
});

var shutdownInProgress = false;
var updateInProgress = false;

var stdin = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

redis.on('connect', (message) => {
  console.log('connect event caught');
});

redis.on('error', (message) => {
  console.log('error event caught');
  clog.error(message);
});

redis.on('wait', (message) => {
  console.log('wait event caught');
});

redis.on('ready', (message) => {
  console.log('ready event caught');
});


redisSub.on('connect', (message) => {
  console.log('connect event caught');
});

redisSub.on('error', (message) => {
  console.log('error event caught');
  clog.error(message);
});

redisSub.on('wait', (message) => {
  console.log('wait event caught');
});

redisSub.on('ready', (message) => {
  console.log('ready event caught');
});


redisLockClient.on('connect', (message) => {
  console.log('connect event caught');
});

redisLockClient.on('error', (message) => {
  console.log('error event caught');
  clog.error(message);
});

redisLockClient.on('wait', (message) => {
  console.log('wait event caught');
});

redisLockClient.on('ready', (message) => {
  console.log('ready event caught');
});

if (debug) clog.debug('process.env', process.env);
if (debug) clog.debug('SRCDS config', srcdsConfig);
if (debug) clog.debug('SRCDS command line', srcdsCommandLine);

const initDownloaderCheck = await redis.get('downloaderAvailable');
if (debug) clog.debug('initDownloaderCheck', initDownloaderCheck);

var lockRenewInterval = null;

// Check to see if the lock exists
if (debug) clog.debug(`Checking for lock on ${ident}:srcdsLock`);
const lockCheck = await redis.get(`${ident}:srcdsLock`);
if (debug) clog.debug("Variable 'lockCheck'", lockCheck);
if (lockCheck) {
  // We shouldn't reach this point unless something is wrong
  // So we throw
  throw new Error('Locked');
} else {
  // Acquire our lock
  if (debug) clog.debug(`Attempting to acquire lock on ${ident}:srcdsLock`);
  const lock = await redisLock.lock(`${ident}:srcdsLock`, 60000);
  if (debug) clog.debug('Lock acquired');
  console.log(`Lock acquired on ${ident}:srcdsLock`);
  // Setup an interval to renew running instance flags
  renewInstanceInfo(60000);
  lockRenewInterval = setInterval(() => {
    if (debug) clog.debug('Extending lock');
    lock.extend(60000);
    renewInstanceInfo(60000);
  }, 30000); // Renew in 30 seconds

  // Check update status
  const updateStatus = await checkWaitUpdate();
  clog.debug(updateStatus);
  if (updateStatus === 'error') {
    //await lock.unlock();
    //if (errorAction === 'throw') throw new Error(`updateStatus in invalid state: ${updateStatus}`);
    //clog.error(`updateStatus in invalid state: ${updateStatus}`);
    await waitUpdateStatus();
    await spawnSrcds(lock);
  } else if (updateStatus === 'waiting' || updateStatus === 'running') {
    await waitUpdateStatus();
    await spawnSrcds(lock);
  } else if (updateStatus === 'notRequired' || updateStatus === 'complete') {
    // Spawn srcds
    await spawnSrcds(lock);
  }
}

async function renewInstanceInfo(time) {
  time = time || 60000; // Default to 60 seconds
  var ttl = new Date();
  ttl = new Date(ttl.getTime() + time).getTime();
  if (debug) clog.debug('Renewing instance info');
  await redis.zadd('requiredAppIDs', ttl, srcdsConfig.appid);
  await redis.zadd(`${srcdsConfig.appid}:instances`, ttl, ident);
}

async function renewRunningInstanceInfo(time) {
  time = time || 60000; // Default to 60 seconds
  var ttl = new Date();
  ttl = new Date(ttl.getTime() + time).getTime();
  if (debug) clog.debug('Renewing running instance info');
  await redis.zadd(`${srcdsConfig.appid}:runningInstances`, ttl, ident);
}

async function checkWaitUpdate(force) {
  const downloaderAvailable = await redis.get('downloaderAvailable');
  if (debug) clog.debug('downloaderAvailable', downloaderAvailable);
  if (downloaderAvailable === 'true') {
    if (force) {
      // Don't bother checking updateStatus flag
      if (debug) clog.debug('Publishing updateRequestEvent');
      console.log(`Requesting an update for appid ${srcdsConfig.appid}`);
      redis.publish(
        'updateRequestEvent',
        JSON.stringify({
          appid: srcdsConfig.appid,
        }),
      );
      return await waitUpdateStatus();
    } else {
      const updateStatus = await redis.get(`${srcdsConfig.appid}:updateStatus`);
      if (debug) clog.debug('updateStatus', updateStatus);
      if (updateStatus === 'notRequired') {
        return 'notRequired';
      } else if (updateStatus === 'running' || updateStatus === 'waiting') {
        return await waitUpdateStatus();
      } else {
        // Status is invalid, req an update
        if (debug) clog.debug('Publishing updateRequestEvent');
        console.log(`Requesting an update for appid ${srcdsConfig.appid}`);
        redis.publish(
          'updateRequestEvent',
          JSON.stringify({
            appid: srcdsConfig.appid,
          }),
        );
        return await waitUpdateStatus();
      }
    }
  } else {
    // Subscribe to downloaderAvailableEvent
    await waitDownloaderAvailable();
    const updateStatus = await redis.get(`${srcdsConfig.appid}:updateStatus`);
    if (debug) clog.debug('updateStatus', updateStatus);
    if (updateStatus === 'notRequired') {
      console.log(`${appid} already up to date, continuing`);
      return 'notRequired';
    } else if (updateStatus === 'running' || updateStatus === 'waiting') {
      console.log(`Update for ${srcdsConfig.appid} already in progress, waiting`);
      return await waitUpdateStatus();
    } else {
      // Status is invalid, req an update
      if (debug) clog.debug('Publishing updateRequestEvent');
      console.log(`Requesting an update for appid ${srcdsConfig.appid}`);
      redis.publish(
        'updateRequestEvent',
        JSON.stringify({
          appid: srcdsConfig.appid,
        }),
      );
      return await waitUpdateStatus();
    }
  }
}

function waitUpdateStatus() {
  return new Promise((resolve, reject) => {
    redisSub.subscribe(`${srcdsConfig.appid}:updateStatusEvent`);
    redisSub.on('message', (channel, message) => {
      if (channel === `${srcdsConfig.appid}:updateStatusEvent`) {
        if (message === 'complete') {
          redisSub.unsubscribe(`${srcdsConfig.appid}:updateStatusEvent`);
          return resolve('complete');
        } else if (message === 'error') {
          redisSub.unsubscribe(`${srcdsConfig.appid}:updateStatusEvent`);
          return resolve('error');
        }
      }
    });
  });
}

function waitDownloaderAvailable() {
  return new Promise((resolve, reject) => {
    redisSub.subscribe('downloaderAvailableEvent');
    redisSub.on('message', (channel, message) => {
      if (channel === 'downloaderAvailableEvent') {
        if (message === 'true') {
          redisSub.unsubscribe('downloaderAvailableEvent');
          return resolve('complete');
        }
      }
    });
  });
}

async function spawnSrcds(lock) {
  const runningInstanceRenewInterval = setInterval(() => {
    renewRunningInstanceInfo(60000);
  }, 30000);
  // Spawn srcds
  if (debug) clog.debug(`Spawning srcds at ${serverFilesDir}/srcds_linux with options`, srcdsCommandLine);
  const srcds = pty.spawn(`/bin/bash`, srcdsCommandLine, {
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

  stdin.on('line', (line) => {
    srcds.write(`${line}\r\n`);
  });

  // Watch stdout for update notifications
  srcds.onData(async (data) => {
    data = data.toString();
    console.log(data);
    if (data.includes('MasterRequestRestart')) {
      console.log('\n\nServer update required\n\n');
      console.log('\n\nServer will restart for update automatically, please wait\n\n');
      if (isTrustedUpdateSource) {
        redis.publish(
          'updateRequestEvent',
          JSON.stringify({
            appid: srcdsConfig.appid,
          }),
        );
      }
    }
  });

  srcds.onExit(async (exit) => {
    if (shutdownInProgress) {
      if (debug) clog.debug('srcds exited with code', exit);
      await renewRunningInstanceInfo(0); // Expire it now
      await lock.unlock();
      redisSub.unsubscribe(`${srcdsConfig.appid}:shutdownRequiredEvent`);
      clearInterval(runningInstanceRenewInterval);
      srcds.removeAllListeners();
      stdin.removeAllListeners();
      stdin.close();
      shutdownRedis(1000);
    } else if (updateInProgress) {
      if (debug) clog.debug('srcds exited with code', exit);
      await renewRunningInstanceInfo(0); // Expire it now
      redisSub.unsubscribe(`${srcdsConfig.appid}:shutdownRequiredEvent`);
      clearInterval(runningInstanceRenewInterval);
      srcds.removeAllListeners();
      stdin.removeAllListeners();
    } else {
      if (debug) clog.debug('srcds exited with code', exit);
      await renewRunningInstanceInfo(0); // Expire it now
      redisSub.unsubscribe(`${srcdsConfig.appid}:shutdownRequiredEvent`);
      srcds.removeAllListeners();
      stdin.removeAllListeners();
      clearInterval(runningInstanceRenewInterval);
      await spawnSrcds(lock);
    }
  });

  redisSub.subscribe(`${srcdsConfig.appid}:shutdownRequiredEvent`);
  redisSub.on('message', async (channel, message) => {
    if (channel === `${srcdsConfig.appid}:shutdownRequiredEvent`) {
      updateInProgress = true;
      await shutdownSrcds(srcds, message);
      await waitUpdateStatus();
      updateInProgress = false;
      spawnSrcds(lock);
    }
  });

  process.on('SIGTERM', async () => {
    if (debug) clog.debug('SIGTERM received, shutting down');
    await shutdownSrcds(srcds, 'SIGTERM');
    clearInterval(runningInstanceRenewInterval);
  });

  return srcds;
}

function shutdownSrcds(srcds, reason) {
  if (srcds) {
    return new Promise((resolve, reject) => {
      reason = reason || 'unknown';
      // Prepare a sigkill if srcds doesn't exit within 10 seconds
      // Ask SRCDS to exit cleanly
      // First 'say' and 'echo' the date the command was received
      srcds.write(`\n\nsay 'quit' command received at ${new Date().toTimeString()} [${reason}]\n\n`, 'utf8');
      // Then send the 'quit' command
      srcds.write('\n\nquit\n\n');
      srcds.onExit(async (exit) => {
        await renewRunningInstanceInfo(0);
        return resolve(exit);
      });
    });
  } else {
    return 0;
  }
}

function shutdownRedis(time) {
  setTimeout(() => {
    console.log('Shutting down redis clients');
    redis.quit();
    redisSub.unsubscribe();
    redisSub.removeAllListeners();
    redisSub.quit();
    redisLockClient.quit();
  }, time);
}

process.on('SIGTERM', async () => {
  if (debug) clog.debug('SIGTERM received, shutting down');
  shutdownInProgress = true;
  clearInterval(lockRenewInterval);
  await renewRunningInstanceInfo(0);
  await renewInstanceInfo(0);
  process.removeAllListeners();
  setTimeout(() => {
    shutdownRedis(0);
  }, 10000).unref();
});
