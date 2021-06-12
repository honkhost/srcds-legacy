'use strict';

// This serves as the entrypoint for docker
// And manages the srcds wrapper script srcds_wrapper.mjs

import { default as child_process } from 'child_process';
import { default as clog } from 'ee-log';
import { default as _redis } from 'redis';
import { default as util } from 'util';

// TODO: check redis for basefiles_ready:<gameid> = true

// TODO: subscribe to redis update_available:<gameid> chanel

// TODO: write more TODO's

const debug = true;

const config = {
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
  redisPassword: process.env.REDIS_PASSWORD,
  appid: process.env.SRCDS_GAMEID,
};

if (debug) clog.debug('Config:', config);

// Node-redis v4 pls come out soon ;_;
const client = _redis.createClient({
  return_buffers: false,
  password: process.env.REDIS_PASSWORD,
  host: 'redis',
});
var redis = client;
redis.set = util.promisify(client.set).bind(client);
redis.get = util.promisify(client.get).bind(client);

var child = null;

redis
  .get(`${config.appid}.updateStatus`)
  .then((value) => {
    clog.debug(value);
    if (value === 'ready') {
      console.log('\n\nStarting srcds\n\n');
      child = child_process.fork('./srcds_wrapper.mjs', [], {
        stdio: 'inherit',
      });
      child.on('message', (msg) => {
        if (debug) clog.debug(msg);
        if (msg === 'UPDATEREQUIRED') {
          console.log('\n\nUpdate required, stopping srcds\n\n');
          child.kill('SIGTERM');
        }
      });
      child.on('exit', (code) => {
        console.log(`\n\nsrcds_runner.mjs exited with code ${code}\n\n`);
        process.exitCode = code;
      });
      return;
    } else if (value === 'running') {
      console.log('\n\nUpdate in progress, delaying server start\n\n');
      redis.subscribe(`${config.appid}.updateNotification`);
      return;
    } else if (value === null) {
      console.log('\n\nUnable to check update status, delaying server start\n\n');
      redis.subscribe(`${config.appid}.updateNotification`);
      return;
    } else {
      throw new Error('Unable to check update flags from redis');
    }
  })
  .catch((err) => {
    clog.error(err);
    return;
  });

redis.on('message', (channel, msg) => {
  if (channel === `${config.appid}.updateNotification`) {
    if (msg === 'complete') {
      console.log('\n\nUpdate complete, starting srcds\n\n');
      child = child_process.fork('./srcds_wrapper.mjs', [], {
        stdio: 'inherit',
      });
      child.on('message', (msg) => {
        if (debug) clog.debug(msg);
        if (msg === 'UPDATEREQUIRED') {
          console.log('\n\nUpdate required, stopping srcds\n\n');
          child.kill('SIGTERM');
          setTimeout(() => {
            child = child_process.fork('./srcds_wrapper.mjs', [], {
              stdio: 'inherit',
            });
          }, 30000);
        }
      });
      child.on('exit', (code) => {
        console.log(`\n\nsrcds_runner.mjs exited with code ${code}\n\n`);
        process.exitCode = code;
      });
      return;
    }
  }
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
  redis.unsubscribe();
  redis.removeAllListeners();
  redis.quit();
});
