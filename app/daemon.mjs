'use strict';

// This serves as the entrypoint for docker
// And manages the srcds wrapper script srcds_runner.mjs

import { default as child_process } from 'child_process';
import { default as clog } from 'ee-log';

// TODO: check redis for basefiles_ready:<gameid> = true

// TODO: subscribe to redis update_available:<gameid> chanel

// TODO: write more TODO's

const debug = true;

const config = {
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
  redisPassword: process.env.REDIS_PASSWORD,
};

if (debug) clog.debug('Config:', config);

const child = child_process.fork('./srcds_runner.mjs', [], {
  stdio: 'inherit',
});

child.on('exit', (code) => {
  console.log(`\n\nsrcds_runner.mjs exited with code ${code}\n\n`);
  process.exitCode = code;
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});
