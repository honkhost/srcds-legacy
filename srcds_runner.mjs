'use strict';

// Daemon
// Do not run by hand

// Imports
import { default as path } from 'path';

// We're using dotenv for now to load config from .env, but once we're containerized we'll just get them directly
import { default as dotenv } from 'dotenv';

// Get config from .env
const config = dotenv.config();
console.log(config);

// Sub to redis update channel

// Enter user namespace

// Create overlayfs mounts

// Start srcds
//const gameDir = path.join(basedir, ident, gameID);

//const srcdsCommandLine = `${gameDir}/srcds_run -game ${game} -usercon -strictportbind -ip ${ip} -port ${port} +clientport ${clientPort} +tv_port ${HLTVPort} +sv_setsteamaccount ${gslt} -tickrate ${tickrate} +map ${defaultmap} +servercfgfile ${servercfg} -maxplayers_override ${maxplayers} +game_type ${gametype} +game_mode ${gamemode} -authkey ${wsapikey} -nobreakpad`;

//console.log(srcdsCommandLine);
