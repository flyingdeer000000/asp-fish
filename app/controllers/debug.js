'use strict';

let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let loggerClient = quick.logger.getLogger('client', __filename);
let loggerServer = quick.logger.getLogger('server', __filename);
let loggerHandler = quick.logger.getLogger('handler', __filename);

const debugServer = 1;
const debugClient = 1;
let systemlog = 0;
let Controller = function (app) {
    this.app = app;
    systemlog = 1;
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;

proto.serverpush = function (route, msg, players) {
    if (debugServer != 1) return;
    loggerServer.warn('\x1b[36m%s\x1b[0m\n', '\nServer push to players:' + players + '\x1b[0m\nroute: ' + route + ' \nmsg: ' + msg);
}

proto.client = function (msg, session) {
    if (debugClient != 1) return;
    //logger.warn('\n\x1b[35m%s\x1b[0m','Client :\x1b[0m\nfun: ', location+' \nmsg: '+ msg );
    let msgObject = _.cloneDeep(msg);
    try {
        msgObject['playerId'] = (!!session.uid) ? session.uid : 'none';
    } catch (e) {
        msgObject['playerId'] = 'none';
    }
    loggerClient.info('[ClientSend.' + msg.__route__ + '] ' + JSON.stringify(msgObject));
}

proto.info = function (level, action, msg, type) {
    if (systemlog == 0) return;
    let debugstring = null;
    if (!!type && type == 1) {
        debugstring = msg;
    } else {
        debugstring = JSON.stringify(msg)
    }
    switch (level) {
        case 'info':
            loggerHandler.info('[' + action + '] ' + debugstring);
            break;
        case 'err':
        case 'error':
            loggerHandler.error('[%s]', action, ' error: ', msg);
            break;
        case 'warn':
            loggerHandler.warn('[' + action + '] ' + debugstring);
            break;
    }

}
