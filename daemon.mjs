'use strict';

// Daemon
// Do not run by hand

// Imports
import { default as path } from 'path';

// Sub to redis update channel

// Start srcds

// Provide a socket? for console access
const basedir = '/opt/srcds/serverfiles';
const ident = '9f93dc';
const gameID = '740';
const gameDir = path.join(basedir, ident, gameID);

const game = 'csgo';
const ip = '0.0.0.0';
const port = '27015';
const clientPort = '27005';
const HLTVPort = '27020';

const tickrate = '64';
const defaultmap = 'de_nuke';
const servercfg = 'server.cfg';

const maxplayers = '12';
const gametype = '1';
const gamemode = '1';

const gslt = 'sekrit';
const wsapikey = 'sekrit';

const srcdsCommandLine = `${gameDir}/srcds_run -game ${game} -usercon -strictportbind -ip ${ip} -port ${port} +clientport ${clientPort} +tv_port ${HLTVPort} +sv_setsteamaccount ${gslt} -tickrate ${tickrate} +map ${defaultmap} +servercfgfile ${servercfg} -maxplayers_override ${maxplayers} +game_type ${gametype} +game_mode ${gamemode} -authkey ${wsapikey} -nobreakpad`;

console.log(srcdsCommandLine);
